// src/moderation/moderation.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AiModerationService } from './ai-moderation.service';
import { ModerationRepositoryService } from './moderation-repository.service';
import { ModerationController } from './moderation.controller';
import { ModerationWebhookController } from './moderation-webhook.controller';
import { ModerationEventsListener } from './moderation-events.listener';
import { User } from '../user/entities/user.entity';
import { ModerationLog } from './entities/moderation-log.entity';
import { ModerationOperation } from './entities/moderation-operation.entity';
import { AnonymousConfession } from '../confession/entities/confession.entity';
import { Report } from '../admin/entities/report.entity';
import { NotificationsModule as InAppNotificationModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ModerationWebhookEvent } from './entities/moderation-webhook-event.entity';
import { ModerationWebhookEventStore } from './moderation-webhook-event.store';
import {
  ModerationOperationsController,
  ModeratorSensitiveQueueController,
} from './moderation-operations.controller';
import { ModerationOperationsService } from './moderation-operations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ModerationLog,
      ModerationOperation,
      Report,
      AnonymousConfession,
      User,
      ModerationWebhookEvent,
    ]),
    ConfigModule,
    InAppNotificationModule,
    AuditLogModule,
  ],
  controllers: [
    ModerationController,
    ModerationWebhookController,
    ModerationOperationsController,
    ModeratorSensitiveQueueController,
  ],
  providers: [
    AiModerationService,
    ModerationRepositoryService,
    ModerationEventsListener,
    ModerationWebhookEventStore,
    ModerationOperationsService,
  ],
  exports: [AiModerationService, ModerationRepositoryService],
})
export class ModerationModule {}
