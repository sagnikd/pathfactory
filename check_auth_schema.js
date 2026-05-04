const postgres=require('postgres');
const fs=require('fs');
const env=fs.readFileSync('.env.local','utf8');
const m=env.match(/DATABASE_URL="([^"]+)"/);
if(!m){console.error('no DATABASE_URL');process.exit(1)}
const sql=postgres(m[1],{prepare:false});
(async()=>{
  try{
    const r1=await sql`select tablename, rowsecurity from pg_tables where schemaname='auth' order by tablename`;
    console.log('AUTH TABLE RLS', JSON.stringify(r1,null,2));
    const r2=await sql`select trigger_name,event_object_table,action_timing,event_manipulation from information_schema.triggers where event_object_schema='auth' and event_object_table='users' order by trigger_name`;
    console.log('AUTH USERS TRIGGERS', JSON.stringify(r2,null,2));
  }catch(e){
    console.error('ERR', e.message);
  }finally{
    await sql.end({timeout:1});
  }
})();
