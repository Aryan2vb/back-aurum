import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get()
  checkHealth() {
    return {
      status: 'AURUM Systems - All Systems Operational',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
