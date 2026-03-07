#!/usr/bin/env node

/**
 * Script to validate DATABASE_URL format
 */

require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL is not set');
  process.exit(1);
}

console.log('DATABASE_URL format check:');
console.log('URL:', databaseUrl.replace(/:[^:@]+@/, ':****@')); // Hide password

// Basic validation
try {
  const url = new URL(databaseUrl);
  console.log('✅ URL format is valid');
  console.log('   Protocol:', url.protocol);
  console.log('   Host:', url.hostname);
  console.log('   Port:', url.port);
  console.log('   Path:', url.pathname);
  console.log('   Search params:', url.search);
} catch (error) {
  console.error('❌ Invalid URL format:', error.message);
  console.error('\nExpected format:');
  console.error('postgresql://user:password@host:port/database?pgbouncer=true');
  process.exit(1);
}




