import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app.error';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';

@Catch()
export class AcademicErrorsFilter extends AllExceptionsFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025')
        error = new AppError('RESOURCE_NOT_FOUND', 'Resource not found', HttpStatus.NOT_FOUND);
      else if (error.code === 'P2002' || error.code === 'P2034')
        error = new AppError(
          'RESOURCE_CONFLICT',
          'The resource changed or this operation already exists',
          HttpStatus.CONFLICT,
        );
      else if (error.code === 'P2003')
        error = new AppError(
          'INVALID_REFERENCE',
          'A referenced resource is not available',
          HttpStatus.BAD_REQUEST,
        );
    }
    super.catch(error, host);
  }
}
