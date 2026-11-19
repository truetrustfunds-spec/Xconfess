import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../auth/interfaces/jwt-payload.interface';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../user/entities/user.entity';
import { ModerationOperationsService } from './moderation-operations.service';

@ApiTags('Admin - Moderation operations')
@ApiBearerAuth()
@Controller('admin/moderation/operations')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ModerationOperationsController {
  constructor(private readonly operations: ModerationOperationsService) {}

  @Post('report-clusters')
  @ApiOperation({ summary: 'Preview likely duplicate reports without changing reports' })
  clusterReports(@Req() req: AuthenticatedRequest) {
    return this.operations.clusterReports(String(req.user.id));
  }

  @Post('shadow-evaluation')
  @ApiOperation({ summary: 'Evaluate proposed thresholds on bounded local fixtures only' })
  shadowEvaluation(
    @Body() body: { highThreshold: number; mediumThreshold: number },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.operations.runShadowEvaluation(String(req.user.id), body);
  }

  @Post('policy-previews')
  @ApiOperation({ summary: 'Preview affected records before changing moderation thresholds' })
  previewPolicy(
    @Body() body: { highThreshold: number; mediumThreshold: number },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.operations.previewPolicy(String(req.user.id), body);
  }

  @Post('policy-apply')
  @ApiOperation({ summary: 'Apply the exact, unexpired policy preview after approval' })
  applyPolicy(
    @Body() body: { previewId: string; approved: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.operations.applyPolicy(
      String(req.user.id),
      body.previewId,
      body.approved,
    );
  }

  @Post('policy-rollback')
  @ApiOperation({ summary: 'Roll back a policy change if it remains the active policy' })
  rollbackPolicy(
    @Body() body: { operationId: string; reason: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.operations.rollbackPolicy(
      String(req.user.id),
      body.operationId,
      body.reason,
    );
  }

  @Post('access-grants')
  @ApiOperation({ summary: 'Grant time-bounded sensitive-queue access to a moderator' })
  createAccessGrant(
    @Body() body: { moderatorId: number; expiresAt: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.operations.createAccessGrant(
      String(req.user.id),
      body.moderatorId,
      body.expiresAt,
    );
  }
}

@ApiTags('Moderator - Sensitive queue')
@ApiBearerAuth()
@Controller('moderator/sensitive-queue')
@UseGuards(JwtAuthGuard)
export class ModeratorSensitiveQueueController {
  constructor(private readonly operations: ModerationOperationsService) {}

  @Get()
  @ApiOperation({ summary: 'Read the sensitive queue with an active explicit grant' })
  async getQueue(@Req() req: AuthenticatedRequest) {
    if (![UserRole.ADMIN, UserRole.MODERATOR].includes(req.user.role)) {
      throw new ForbiddenException('Only moderators can access this queue.');
    }
    return this.operations.getGrantedQueue(req.user.id);
  }
}
