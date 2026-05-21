import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { TestUploadController } from './test-upload.controller';

@Module({
  controllers: [AppController, TestUploadController],
})
export class AppModule {}
