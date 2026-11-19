import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Report, ReportStatus } from '../admin/entities/report.entity';
import { AuditActionType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { User, UserRole } from '../user/entities/user.entity';
import { AiModerationService } from './ai-moderation.service';
import { ModerationLog } from './entities/moderation-log.entity';
import { ModerationOperation } from './entities/moderation-operation.entity';

const MAX_SAMPLES = 250;
const MAX_PREVIEW_RECORDS = 100;
const GRANT_MAX_HOURS = 12;
const GRANT_SCOPE = 'sensitive_queue';
const MAX_CLUSTER_REASON_LENGTH = 500;
const SHADOW_FIXTURES = [
  'Please share your thoughts respectfully.',
  'I disagree with that idea, but I understand your point.',
  'Please avoid racist language in this discussion.',
  'That comment uses hateful language.',
  'The report describes a threat to attack someone at an event.',
  'Moderators review reports about threats and violence.',
  'Claim a free reward at https://example.test today.',
  'This message contains repeated characters: wowwwww.',
  'Please contact the organizer for more information.',
  'The community team welcomes constructive feedback.',
];

interface Thresholds {
  highThreshold: number;
  mediumThreshold: number;
}

@Injectable()
export class ModerationOperationsService implements OnModuleInit {
  constructor(
    @InjectRepository(ModerationOperation)
    private readonly operations: Repository<ModerationOperation>,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    @InjectRepository(ModerationLog)
    private readonly moderationLogs: Repository<ModerationLog>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly aiModeration: AiModerationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    const latestAppliedChange = await this.operations.findOne({
      where: { type: 'policy_change', status: 'applied' },
      order: { createdAt: 'DESC' },
    });
    if (latestAppliedChange) {
      const activeThresholds = latestAppliedChange.payload.after as Thresholds;
      this.aiModeration.updateThresholds(
        activeThresholds.highThreshold,
        activeThresholds.mediumThreshold,
      );
      return;
    }

    const firstChange = await this.operations.findOne({
      where: { type: 'policy_change' },
      order: { createdAt: 'ASC' },
    });
    const baseline = firstChange?.payload.before as Thresholds | undefined;
    if (baseline) {
      this.aiModeration.updateThresholds(
        baseline.highThreshold,
        baseline.mediumThreshold,
      );
    }
  }

  async clusterReports(actorId: string) {
    const reports = await this.reports.find({
      where: { status: ReportStatus.PENDING },
      order: { createdAt: 'DESC' },
      take: MAX_SAMPLES,
      select: ['id', 'confessionId', 'type', 'reason', 'createdAt'],
    });
    const groups = new Map<string, Report[]>();
    for (const report of reports) {
      if ((report.reason?.length ?? 0) > MAX_CLUSTER_REASON_LENGTH) continue;
      const normalizedReason = this.normalizeReason(report.reason);
      if (normalizedReason.length < 12) continue;
      const key = [
        report.confessionId,
        report.type,
        normalizedReason,
      ].join(':');
      groups.set(key, [...(groups.get(key) ?? []), report]);
    }

    const clusters = [...groups.values()]
      .filter((group) => group.length > 1)
      .map((group) => ({
        reportIds: group.map(({ id }) => id),
        confessionId: group[0].confessionId,
        reportType: group[0].type,
        signal: 'same confession, report type, and normalized reason',
        count: group.length,
      }));
    await this.operations.save(
      this.operations.create({
        type: 'report_clusters',
        actorId,
        subjectId: null,
        scope: null,
        status: 'complete',
        expiresAt: null,
        payload: { scannedCount: reports.length, clusters },
      }),
    );
    await this.audit(AuditActionType.BULK_ACTION, actorId, 'report_clusters', {
      scannedCount: reports.length,
      clusterCount: clusters.length,
    });
    return { scannedCount: reports.length, clusters };
  }

  async runShadowEvaluation(actorId: string, proposed: Thresholds) {
    this.validateThresholds(proposed);
    const baseline = this.getCurrentThresholds();
    const fixtures = SHADOW_FIXTURES.slice(0, MAX_SAMPLES);
    const transitions: Record<string, number> = {};
    let changedCount = 0;
    const startedAt = Date.now();

    for (const fixture of fixtures) {
      const score = this.aiModeration.scoreOffline(fixture);
      const from = this.classify(score, baseline);
      const to = this.classify(score, proposed);
      if (from !== to) {
        changedCount += 1;
        const key = `${from}->${to}`;
        transitions[key] = (transitions[key] ?? 0) + 1;
      }
    }

    const result = {
      evaluatedAt: new Date().toISOString(),
      fixtureCount: fixtures.length,
      changedCount,
      unchangedCount: fixtures.length - changedCount,
      transitions,
      averageLatencyMs:
        fixtures.length === 0 ? 0 : (Date.now() - startedAt) / fixtures.length,
      baselineThresholds: baseline,
      proposedThresholds: proposed,
    };
    await this.operations.save(
      this.operations.create({
        type: 'shadow_evaluation',
        actorId,
        subjectId: null,
        scope: null,
        status: 'complete',
        expiresAt: null,
        payload: result,
      }),
    );
    await this.audit(AuditActionType.BULK_ACTION, actorId, 'shadow_evaluation', {
      fixtureCount: result.fixtureCount,
      changedCount,
      averageLatencyMs: result.averageLatencyMs,
    });
    return result;
  }

  async previewPolicy(actorId: string, proposed: Thresholds) {
    this.validateThresholds(proposed);
    const baseline = this.getCurrentThresholds();
    const records = await this.moderationLogs
      .createQueryBuilder('log')
      .where('log.moderationStatus IN (:...statuses)', {
        statuses: ['pending', 'flagged'],
      })
      .orderBy('log.createdAt', 'DESC')
      .take(MAX_PREVIEW_RECORDS)
      .getMany();
    const representativeRecords = records
      .map((record) => {
        const score = this.aiModeration.scoreOffline(record.content);
        const from = this.classify(score, baseline);
        const to = this.classify(score, proposed);
        return {
          id: record.id,
          score,
          from,
          to,
          reason: this.describeTransition(to, score, proposed),
        };
      })
      .filter((record) => record.from !== record.to);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const preview = await this.operations.save(
      this.operations.create({
        type: 'policy_preview',
        actorId,
        subjectId: null,
        scope: null,
        status: 'pending',
        expiresAt,
        payload: { baseline, proposed, representativeRecords },
      }),
    );
    return {
      previewId: preview.id,
      expiresAt: expiresAt.toISOString(),
      affectedCount: representativeRecords.length,
      sampleLimit: MAX_PREVIEW_RECORDS,
      representativeRecords,
      baselineThresholds: baseline,
      proposedThresholds: proposed,
    };
  }

  async applyPolicy(
    actorId: string,
    previewId: string,
    approved: boolean,
    requestedThresholds?: Thresholds,
  ) {
    if (approved !== true) {
      throw new ForbiddenException('Explicit approval is required.');
    }
    const activeBefore = this.getCurrentThresholds();
    let updatedInMemory = false;
    let change: ModerationOperation;
    try {
      change = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ModerationOperation);
        const preview = await repository.findOne({
          where: {
            id: previewId,
            type: 'policy_preview',
            actorId,
            status: 'pending',
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!preview) {
          throw new ConflictException('No matching policy preview is pending.');
        }
        if (!preview.expiresAt || preview.expiresAt <= new Date()) {
          preview.status = 'expired';
          await repository.save(preview);
          throw new ConflictException('Policy preview expired; create a new preview.');
        }

        const baseline = preview.payload.baseline as Thresholds;
        const proposed = preview.payload.proposed as Thresholds;
        if (
          requestedThresholds &&
          !this.sameThresholds(requestedThresholds, proposed)
        ) {
          throw new ConflictException(
            'Approved thresholds do not match the previewed policy.',
          );
        }
        if (!this.sameThresholds(this.getCurrentThresholds(), baseline)) {
          preview.status = 'stale';
          await repository.save(preview);
          throw new ConflictException('Active policy changed; create a new preview.');
        }

        this.aiModeration.updateThresholds(
          proposed.highThreshold,
          proposed.mediumThreshold,
        );
        updatedInMemory = true;
        preview.status = 'applied';
        await repository.save(preview);
        return repository.save(
          repository.create({
            type: 'policy_change',
            actorId,
            subjectId: null,
            scope: null,
            status: 'applied',
            expiresAt: null,
            payload: { previewId, before: baseline, after: proposed },
          }),
        );
      });
    } catch (error) {
      if (updatedInMemory) {
        this.aiModeration.updateThresholds(
          activeBefore.highThreshold,
          activeBefore.mediumThreshold,
        );
      }
      throw error;
    }
    await this.audit(AuditActionType.BULK_ACTION, actorId, 'policy_applied', {
      operationId: change.id,
      previewId,
      before: activeBefore,
      after: change.payload.after,
    });
    return {
      operationId: change.id,
      thresholds: change.payload.after,
    };
  }

  async rollbackPolicy(actorId: string, operationId: string, reason: string) {
    if (
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.trim().length > 500
    ) {
      throw new BadRequestException('A rollback reason of 1-500 characters is required.');
    }
    const activeBefore = this.getCurrentThresholds();
    let updatedInMemory = false;
    let change: ModerationOperation;
    try {
      change = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ModerationOperation);
        const currentChange = await repository.findOne({
          where: { id: operationId, type: 'policy_change', status: 'applied' },
          lock: { mode: 'pessimistic_write' },
        });
        if (!currentChange) {
          throw new NotFoundException('Applied policy change not found.');
        }
        const before = currentChange.payload.before as Thresholds;
        const after = currentChange.payload.after as Thresholds;
        if (!this.sameThresholds(this.getCurrentThresholds(), after)) {
          throw new ConflictException(
            'Active policy no longer matches this change; rollback refused.',
          );
        }

        this.aiModeration.updateThresholds(
          before.highThreshold,
          before.mediumThreshold,
        );
        updatedInMemory = true;
        currentChange.status = 'rolled_back';
        currentChange.payload = {
          ...currentChange.payload,
          rollbackReason: reason.trim(),
        };
        return repository.save(currentChange);
      });
    } catch (error) {
      if (updatedInMemory) {
        this.aiModeration.updateThresholds(
          activeBefore.highThreshold,
          activeBefore.mediumThreshold,
        );
      }
      throw error;
    }
    const before = change.payload.before as Thresholds;
    const after = change.payload.after as Thresholds;
    await this.audit(AuditActionType.BULK_ACTION, actorId, 'policy_rolled_back', {
      operationId,
      before: after,
      after: before,
      reason: reason.trim(),
    });
    return { operationId, thresholds: before, status: change.status };
  }

  async createAccessGrant(
    actorId: string,
    userId: number,
    expiresAtInput: string,
  ) {
    if (!Number.isSafeInteger(userId) || userId < 1) {
      throw new BadRequestException('A valid moderator user ID is required.');
    }
    const moderator = await this.users.findOne({ where: { id: userId } });
    if (!moderator || moderator.role !== UserRole.MODERATOR) {
      throw new BadRequestException('Access grants can only target moderator accounts.');
    }
    const expiresAt = new Date(expiresAtInput);
    const maxExpiry = Date.now() + GRANT_MAX_HOURS * 60 * 60 * 1000;
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now() ||
      expiresAt.getTime() > maxExpiry
    ) {
      throw new BadRequestException(
        `Grant expiry must be in the future and no more than ${GRANT_MAX_HOURS} hours away.`,
      );
    }
    await this.operations.update(
      {
        type: 'access_grant',
        subjectId: String(userId),
        scope: GRANT_SCOPE,
        status: 'active',
      },
      { status: 'revoked' },
    );
    const grant = await this.operations.save(
      this.operations.create({
        type: 'access_grant',
        actorId,
        subjectId: String(userId),
        scope: GRANT_SCOPE,
        status: 'active',
        expiresAt,
        payload: {},
      }),
    );
    await this.audit(AuditActionType.BULK_ACTION, actorId, 'access_grant_created', {
      grantId: grant.id,
      moderatorId: userId,
      scope: GRANT_SCOPE,
      expiresAt: expiresAt.toISOString(),
    });
    return {
      id: grant.id,
      moderatorId: userId,
      scope: GRANT_SCOPE,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getGrantedQueue(userId: number) {
    const grant = await this.operations.findOne({
      where: {
        type: 'access_grant',
        subjectId: String(userId),
        scope: GRANT_SCOPE,
        status: 'active',
      },
      order: { createdAt: 'DESC' },
    });
    if (!grant || !grant.expiresAt || grant.expiresAt <= new Date()) {
      if (grant) {
        grant.status = 'expired';
        await this.operations.save(grant);
      }
      throw new ForbiddenException('An active sensitive-queue access grant is required.');
    }
    return this.moderationLogs
      .createQueryBuilder('log')
      .where('log.moderationStatus IN (:...statuses)', {
        statuses: ['pending', 'flagged'],
      })
      .orderBy('log.createdAt', 'ASC')
      .take(100)
      .getMany();
  }

  private normalizeReason(reason: string | null): string {
    return (reason ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase('en')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private validateThresholds(thresholds: Thresholds): void {
    if (
      !thresholds ||
      !Number.isFinite(thresholds.highThreshold) ||
      !Number.isFinite(thresholds.mediumThreshold) ||
      thresholds.mediumThreshold <= 0 ||
      thresholds.mediumThreshold >= thresholds.highThreshold ||
      thresholds.highThreshold > 1
    ) {
      throw new BadRequestException('Thresholds must satisfy 0 < medium < high <= 1.');
    }
  }

  private getCurrentThresholds(): Thresholds {
    const { highThreshold, mediumThreshold } = this.aiModeration.getConfiguration();
    return { highThreshold, mediumThreshold };
  }

  private classify(score: number, thresholds: Thresholds): string {
    if (!this.aiModeration.getConfiguration().autoActionEnabled) {
      return 'pending';
    }
    if (score >= thresholds.highThreshold) return 'rejected';
    if (score >= thresholds.mediumThreshold) return 'flagged';
    return 'approved';
  }

  private describeTransition(to: string, score: number, thresholds: Thresholds): string {
    if (to === 'rejected') {
      return `Score ${score.toFixed(2)} meets the proposed rejection threshold.`;
    }
    if (to === 'flagged') {
      return `Score ${score.toFixed(2)} meets the proposed human-review threshold.`;
    }
    return `Score ${score.toFixed(2)} falls below the proposed review threshold (${to}).`;
  }

  private sameThresholds(left: Thresholds, right: Thresholds): boolean {
    return (
      left.highThreshold === right.highThreshold &&
      left.mediumThreshold === right.mediumThreshold
    );
  }

  private async audit(
    action: AuditActionType,
    actorId: string,
    operation: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLog.log({
      actionType: action,
      metadata: {
        entityType: 'moderation_operation',
        operation,
        ...metadata,
      },
      context: {
        userId: actorId,
        actor: { type: 'admin', id: actorId },
      },
    });
  }
}
