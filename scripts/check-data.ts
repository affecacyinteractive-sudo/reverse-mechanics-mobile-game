// scripts/check-data.ts
import "dotenv/config";
import { pool } from "../db";

async function main() {
    console.log("\n1) Action counts by domain");
    {
        const r = await pool.query(`
      select domain, count(*) as n
      from cards
      where kind = 'ACTION' and zone = 'LIBRARY'
      group by domain
      order by domain;
    `);
        console.table(r.rows);
    }

    console.log("\n2) Schools within each domain");
    {
        const r = await pool.query(`
      select domain, school_code, school_name, count(*) as n
      from cards
      where kind = 'ACTION' and zone = 'LIBRARY'
      group by domain, school_code, school_name
      order by domain, school_code;
    `);
        console.table(r.rows);
    }

    console.log("\n3) Sample: first 15 actions in FP (if present)");
    {
        const r = await pool.query(`
      select canon_id, anchor
      from cards
      where kind='ACTION' and zone='LIBRARY' and school_code='FP'
      order by canon_id
      limit 15;
    `);
        console.table(r.rows);
    }

    console.log("\n4) Integrity checks");
    {
        const r1 = await pool.query(`
      select count(*) as missing_school
      from cards
      where kind='ACTION' and zone='LIBRARY'
        and canon_id not in ('GSE-SW','GSE-ST')
        and (school_code is null or school_name is null);
    `);
        const r2 = await pool.query(`
      select count(*) as missing_domain
      from cards
      where kind='ACTION' and zone='LIBRARY'
        and domain is null;
    `);
        console.table({
            missing_school: Number(r1.rows[0].missing_school),
            missing_domain: Number(r2.rows[0].missing_domain),
        });
    }

    console.log("\nDone.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
