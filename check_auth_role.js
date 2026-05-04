const postgres=require('postgres');
const fs=require('fs');
const env=fs.readFileSync('.env.local','utf8');
const m=env.match(/DATABASE_URL="([^"]+)"/);
const sql=postgres(m[1],{prepare:false});
(async()=>{
  try{
    const r=await sql`select current_user, current_database(), current_schema()`;
    console.log(JSON.stringify(r,null,2));
  }catch(e){console.error('ERR', e.message)} finally{await sql.end({timeout:1})}
})();
