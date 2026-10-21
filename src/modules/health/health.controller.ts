import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { HealthService, type HealthStatus, type ReadinessStatus } from './health.service';

@Public()
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Backward-compatible process health endpoint' })
  @ApiOkResponse({ description: 'Process is alive' })
  liveCompatibility(): HealthStatus {
    return this.healthService.live();
  }

  @Get('live')
  @ApiOperation({ summary: 'Kubernetes-style liveness probe' })
  @ApiOkResponse({ description: 'Process is alive' })
  live(): HealthStatus {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe including required dependencies' })
  @ApiOkResponse({ description: 'Application can receive traffic' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable' })
  ready(): Promise<ReadinessStatus> {
    return this.healthService.ready();
  }
}
