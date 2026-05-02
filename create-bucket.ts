import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function createBucket() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    await sql`
      INSERT INTO storage.buckets (id, name, public) 
      VALUES ('assets', 'assets', true)
      ON CONFLICT (id) DO NOTHING;
    `;
    
    // Also create policies to allow public access
    await sql`
      CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'assets');
    `.catch(() => {}); // ignore if policy already exists

    await sql`
      CREATE POLICY "Public Uploads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'assets');
    `.catch(() => {});

    console.log('Bucket created successfully!');
  } catch (error) {
    console.error('Error creating bucket:', error);
  } finally {
    await sql.end();
  }
}

createBucket();
