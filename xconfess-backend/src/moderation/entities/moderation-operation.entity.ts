import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ModerationOperationType =
  | 'access_grant'
  | 'policy_preview'
  | 'policy_change'
  | 'shadow_evaluation'
  | 'report_clusters';

@Entity('moderation_operations')
@Index(['type', 'status', 'createdAt'])
@Index(['subjectId', 'scope', 'expiresAt'])
export class ModerationOperation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: ModerationOperationType;

  @Column({ name: 'actor_id', type: 'varchar', length: 64 })
  actorId!: string;

  @Column({ name: 'subject_id', type: 'varchar', length: 64, nullable: true })
  subjectId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  scope!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'active' })
  status!: string;

  @Column({ name: 'expires_at', type: 'timestamp with time zone', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
