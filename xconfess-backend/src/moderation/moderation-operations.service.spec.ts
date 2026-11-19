import { ForbiddenException } from '@nestjs/common';
import { AuditActionType } from '../audit-log/audit-log.entity';
import { UserRole } from '../user/entities/user.entity';
import { ModerationOperationsService } from './moderation-operations.service';

describe('ModerationOperationsService', () => {
  const operations = {
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn(async (value: Record<string, unknown>) => ({
      id: 'operation-id',
      ...value,
    })),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const reports = { find: jest.fn() };
  const moderationLogs = {
    createQueryBuilder: jest.fn(),
  };
  const users = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn() };
  const aiModeration = {
    getConfiguration: jest.fn(() => ({
      highThreshold: 0.8,
      mediumThreshold: 0.5,
      autoActionEnabled: true,
    })),
    scoreOffline: jest.fn(() => 0.7),
    updateThresholds: jest.fn(),
  };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  let service: ModerationOperationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModerationOperationsService(
      operations as never,
      reports as never,
      moderationLogs as never,
      users as never,
      dataSource as never,
      aiModeration as never,
      auditLog as never,
    );
  });

  it('clusters only matching pending reports and leaves reports untouched', async () => {
    reports.find.mockResolvedValue([
      {
        id: 'r1',
        confessionId: 'c1',
        type: 'spam',
        reason: 'Repeated promotional links',
      },
      {
        id: 'r2',
        confessionId: 'c1',
        type: 'spam',
        reason: ' repeated   promotional links! ',
      },
      {
        id: 'r3',
        confessionId: 'c2',
        type: 'spam',
        reason: 'Repeated promotional links',
      },
    ]);

    const result = await service.clusterReports('7');

    expect(result.clusters).toEqual([
      expect.objectContaining({ reportIds: ['r1', 'r2'], count: 2 }),
    ]);
    expect(reports.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 250 }),
    );
    expect(operations.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'report_clusters', status: 'complete' }),
    );
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: AuditActionType.BULK_ACTION,
      }),
    );
  });

  it('denies sensitive queue access without an active grant', async () => {
    operations.findOne.mockResolvedValue(null);

    await expect(service.getGrantedQueue(7)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(moderationLogs.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('runs shadow evaluations against bounded fixtures without applying thresholds', async () => {
    const result = await service.runShadowEvaluation('7', {
      highThreshold: 0.9,
      mediumThreshold: 0.75,
    });

    expect(result.fixtureCount).toBeLessThanOrEqual(250);
    expect(result.fixtureCount).toBeGreaterThan(0);
    expect(aiModeration.updateThresholds).not.toHaveBeenCalled();
    expect(operations.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shadow_evaluation',
        status: 'complete',
      }),
    );
  });

  it('rejects grants for non-moderator accounts', async () => {
    users.findOne.mockResolvedValue({ id: 8, role: UserRole.USER });

    await expect(
      service.createAccessGrant(
        '1',
        8,
        new Date(Date.now() + 60_000).toISOString(),
      ),
    ).rejects.toThrow('Access grants can only target moderator accounts.');
    expect(operations.save).not.toHaveBeenCalled();
  });
});
