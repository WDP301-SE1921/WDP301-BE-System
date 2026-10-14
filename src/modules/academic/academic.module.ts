import { Module } from '@nestjs/common';
import { AcademicAiService } from '../../integrations/academic-ai.service';
import { AcademicStorageService } from '../../integrations/academic-storage.service';
import { AcademicController } from './academic.controller';
import { AcademicRepository } from './academic.repository';
import { AcademicAccessService } from './academic-access.service';
import { CatalogService } from './catalog.service';
import { EnrollmentWorkflowsService } from './enrollment-workflows.service';
import { AssessmentService } from './assessment.service';
import { AssignmentImportService } from './assignment-import.service';
import { GradingWorkerService } from './grading-worker.service';
import { ReportsService } from './reports.service';
import { AnnouncementsService } from './announcements.service';
import { EmailDeliveriesService } from './email-deliveries.service';

@Module({
  controllers: [AcademicController],
  providers: [
    AcademicRepository,
    AcademicAccessService,
    CatalogService,
    EnrollmentWorkflowsService,
    AssessmentService,
    AssignmentImportService,
    GradingWorkerService,
    ReportsService,
    AnnouncementsService,
    EmailDeliveriesService,
    AcademicAiService,
    AcademicStorageService,
  ],
})
export class AcademicModule {}
