import { Module, Global } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';

@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
