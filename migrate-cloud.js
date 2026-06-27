/**
 * Retail OS — Cloud Database Migration Script
 * Connects to Supabase via the IPv4 pooler and runs schema.sql
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const POOLER_URL = 'postgresql://postgres.ckdvaamghswnsfkwpfjn:lWWBANdj5pSkpsCG@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';

async function migrate() {
  console.log('🔌 Connecting to Supabase (via IPv4 pooler)...');
  
  const client = new Client({
    connectionString: POOLER_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    console.log('✅ Connected to Supabase PostgreSQL!');

    // Read schema
    const schemaPath = path.join(__dirname, 'backend', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📦 Running schema migration...');
    await client.query(schema);
    console.log('✅ Schema migration completed successfully!');

    // Verify tables
    const result = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('\n📋 Tables created:');
    result.rows.forEach(r => console.log(`   • ${r.table_name}`));
    console.log(`\n🎉 Total: ${result.rows.length} tables ready on Supabase!`);

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
