import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get()
  checkHealth() {
    return {
      status: 'i am healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
