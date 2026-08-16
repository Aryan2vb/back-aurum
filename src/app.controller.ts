import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';

@Controller('health')
export class AppController {
  @Public()
  @Get()
  checkHealth() {
    return {
      status: 'AURUM Systems - All Systems Operational',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
