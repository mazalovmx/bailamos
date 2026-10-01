import assert from 'node:assert/strict';
import {db} from '../src/index';
const rollback = new Error('test rollback');
try {
  await db.$transaction(async tx => {
    const city = await tx.city.create({data:{slug:'test-' + Date.now(),name:'Test',countryCode:'MX',timezone:'America/Mexico_City',lat:19.43,lng:-99.13}});
    const event = await tx.event.create({data:{slug:'test-' + Date.now(),title:'Test event',cityId:city.id,timezone:city.timezone,startsAt:new Date(),lat:city.lat,lng:city.lng}});
    assert.equal(event.status,'DRAFT');
    const rows = await tx.$queryRaw<Array<{near:boolean}>>`
      SELECT ST_DWithin(geo, ST_SetSRID(ST_MakePoint(-99.13,19.43),4326)::geography,100) AS near
      FROM "Event" WHERE id = ${event.id}`;
    assert.equal(rows[0]?.near,true);
    await tx.event.update({where:{id:event.id},data:{lat:20,lng:-100}});
    const updated = await tx.$queryRaw<Array<{lat:number}>>`SELECT ST_Y(geo::geometry) AS lat FROM "Event" WHERE id = ${event.id}`;
    assert.equal(updated[0]?.lat,20);
    throw rollback;
  }).catch(error => {
    if (error !== rollback) throw error;
  });
  await assert.rejects(db.city.create({data:{slug:'invalid-' + Date.now(),name:'Invalid',countryCode:'MX',timezone:'America/Mexico_City',lat:100,lng:0}}), /Coordinates out of range/);
  console.log('PostGIS synchronization, radius query, draft default and coordinate constraints verified.');
} finally { await db.$disconnect(); }
