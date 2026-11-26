import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createBlankRelease, reviseRelease } from '../domain/worldbook/release';
import { exportNativeText } from '../domain/worldbook/export';
import { importWorldbookValue } from '../domain/worldbook/importWorldbook';
import { officialIds } from '../domain/worldbook/mainWorldbook';
import { request, transaction } from '../services/storage/idb';
import { WorldbookLibrary } from '../services/storage/worldbookLibrary';
import { LibraryReader } from '../services/worldbook/libraryReader';

it('V3 启用的旧版本原样升级，主书编辑、缺失版本、损坏配置及原回合恢复', async () => {
  const defaultOfficial = Object.fromEntries(officialIds.map(id => [id, true]));
  const name = 'migration', factory = new IDBFactory();
  const old = await createBlankRelease('同名书');
  if (!old.ok) throw Error('fixture');
  const r = old.release;
  const op = factory.open(name,3);
  op.onupgradeneeded = () => {
    const db = op.result;
    const releases = db.createObjectStore('releases',{keyPath:['bookId','versionId']});
    releases.createIndex('bookId','bookId'); releases.createIndex('contentHash','contentHash');
    db.createObjectStore('summaries',{keyPath:['bookId','versionId']}).createIndex('bookId','bookId');
    db.createObjectStore('books',{keyPath:'bookId'}); db.createObjectStore('enabled',{keyPath:'bookId'});
  };
  const v3 = await request(op);
  await transaction(v3,['releases','summaries','books','enabled'],'readwrite',async tx => {
    const ids = { bookId:r.bookId, versionId:r.versionId, contentHash:r.contentHash };
    await request(tx.objectStore('releases').add({...ids, release:r, installedAt:1}));
    await request(tx.objectStore('summaries').add({...ids, title:r.metadata.title, versionLabel:r.versionLabel, entryCount:0, keyCount:0, keyChars:0, contentChars:0, canonicalChars:100, installedAt:1}));
    await request(tx.objectStore('books').add({bookId:r.bookId,title:r.metadata.title, latestVersionId:r.versionId,versionCount:1,installedAt:1,updatedAt:1}));
    await request(tx.objectStore('enabled').add({bookId:r.bookId,enabledAt:1}));
  });
  const reader = new LibraryReader({factory,name});
  expect(await reader.read(r.bookId,r.versionId)).toEqual({ok:true,release:r});
  const blocked = await WorldbookLibrary.open({factory,name});
  expect(blocked).toMatchObject({ok:false,code:'blocked'});
  v3.close(); reader.close();
  const opened = await WorldbookLibrary.open({factory,name});
  if (!opened.ok) throw Error('open');
  const lib = opened.library;
  const db = await request(factory.open(name));
  try {
    expect(await lib.worldview()).toEqual({official:defaultOfficial,books:[]});
    expect(await lib.getRelease(r.bookId,r.versionId,{verifyHash:true})).toEqual({ok:true,release:r});
    expect(await lib.enabledBooks()).toMatchObject({books:[{ref:{versionId:r.versionId,contentHash:r.contentHash}}]});
    const change = await lib.reviseBook(r.bookId,{purpose:'main',add:[{entryId:'lunar',constant:true,content:'原世界的潮历'}]}, {baseVersionId:r.versionId});
    if (!change.ok) throw Error('revise');
    const imported = await importWorldbookValue(JSON.parse(exportNativeText(change.release)));
    expect(imported).toMatchObject({ok:true,release:{bookId:r.bookId,versionId:change.release.versionId,contentHash:change.release.contentHash,metadata:{purpose:'main'}}});
    expect(await lib.install(change.release)).toMatchObject({status:'already_installed'});
    await Promise.all(officialIds.map(id => lib.setOfficial(id,false)));
    const basis = { saveId:'one',createdAt:'2026',turnId:'turn',sourceRevision:0,baseRevision:0,bindingRevision:1 };
    const captured = await lib.worldview(basis,true);
    expect(captured.books[0].entries).toEqual([{entryId:'lunar',content:'原世界的潮历'}]);
    await transaction(db,['releases'],'readwrite',async tx => { await request(tx.objectStore('releases').delete([r.bookId,change.release.versionId])); });
    await expect(lib.worldview()).rejects.toThrow('missing_version');
    expect(await lib.worldview(basis,true,true)).toEqual(captured);
    await lib.setEnabled(r.bookId,false);
    const fresh = await lib.worldview({...basis,bindingRevision:3},true);
    expect(fresh.books).toEqual([]);
    expect(Object.values(fresh.official)).toEqual([false,false]);
    await expect(lib.worldview({...basis,turnId:'old-import'},true,true)).rejects.toThrow('unbound');
    await transaction(db,['mainSettings'],'readwrite',async tx => { await request(tx.objectStore('mainSettings').delete(officialIds[1])); });
    await expect(lib.worldview()).rejects.toThrow();
    expect(await lib.setOfficial()).toEqual({ok:true});
    expect(await lib.worldview()).toEqual({official:defaultOfficial,books:[]});
  } finally { lib.close(); db.close(); }
});

it('切换用途生成独立版本，保留条目与来源', async () => {
  const first = await createBlankRelease('月港');
  if (!first.ok) throw Error('fixture');
  const main = await reviseRelease(first.release,{purpose:'main'});
  if (!main.ok || !main.changed) throw Error('fixture');
  const ordinary = await reviseRelease(main.release,{purpose:'ordinary'});
  expect(ordinary).toMatchObject({ok:true,changed:true,release:{bookId:first.release.bookId,metadata:{purpose:'ordinary'},entries:[],source:first.release.source}});
});
