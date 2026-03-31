import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get()
  checkHealth() {
    return {
      status: 'all ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
