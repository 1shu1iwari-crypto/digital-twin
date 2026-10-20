/* Member and clinician use separate browser contexts, as on separate devices. */
const {chromium}=require('../frontend/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CARDIOTWIN_BROWSER_EXECUTABLE||undefined});
  try {
    const doctorContext=await browser.newContext({viewport:{width:1440,height:1000}});
    const memberContext=await browser.newContext({viewport:{width:390,height:844}});
    const doctor=await doctorContext.newPage(), member=await memberContext.newPage();
    const errors=[];
    doctor.on('pageerror',e=>errors.push(e.message));member.on('pageerror',e=>errors.push(e.message));
    const base='http://127.0.0.1:8011';
    await doctor.goto(base);
    await doctor.getByRole('button',{name:'Wearable connections',exact:true}).click();
    await doctor.getByRole('button',{name:'Enter clinician demo',exact:true}).click();
    await doctor.getByLabel('Patient record',{exact:true}).selectOption('HF-0004');
    await doctor.getByRole('button',{name:'Create member invitation',exact:true}).click();
    await doctor.getByLabel('One-time member link',{exact:true}).waitFor();
    const invitation=await doctor.getByLabel('One-time member link',{exact:true}).inputValue();
    assert.match(invitation,/#join\//);
    assert.equal((await member.request.get(`${base}/api/care/workspace`)).status(),401);
    await member.goto(invitation);
    await member.getByRole('button',{name:'Open my invitation',exact:true}).click();
    await member.getByRole('heading',{name:'Choose what your care team receives.'}).waitFor();
    assert.equal(await member.locator('input[type=checkbox]:checked').count(),0);
    await member.getByLabel('Resting heart rate',{exact:false}).check();
    await member.getByLabel('Body weight',{exact:false}).check();
    await member.getByRole('checkbox',{name:/I choose to share/}).check();
    await member.screenshot({path:path.join('test-results','member-consent-mobile.png'),fullPage:true});
    await member.getByRole('button',{name:'Save sharing choices',exact:true}).click();
    await member.getByRole('heading',{name:'Send your daily summary.'}).waitFor();
    await member.getByRole('button',{name:'Use fictional example',exact:true}).click();
    await member.getByRole('button',{name:'Preview my summary',exact:true}).click();
    await member.getByRole('heading',{name:'Check before sending.'}).waitFor();
    const before=await (await doctor.request.get(`${base}/api/patients/HF-0004/timeline?days=90`)).json();
    for(const width of [360,768,1440]) {
      await member.setViewportSize({width,height:1000});
      assert.ok(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Member form overflows at ${width}`);
    }
    await member.screenshot({path:path.join('test-results','member-preview-desktop.png'),fullPage:true});
    await member.getByRole('button',{name:'Send to care team',exact:true}).click();
    await member.getByRole('status').filter({hasText:'Delivered to your care team.'}).waitFor();
    assert.deepEqual(await (await doctor.request.get(`${base}/api/patients/HF-0004/timeline?days=90`)).json(),before);
    await doctor.getByRole('button',{name:'Refresh reviews',exact:true}).click();
    await doctor.locator('.submission-row').filter({hasText:'Awaiting review'}).first().click();
    await doctor.getByRole('button',{name:'Accept & update twin',exact:true}).waitFor();
    await doctor.screenshot({path:path.join('test-results','clinician-review-desktop.png'),fullPage:true});
    for(const width of [360,768,1440]) {
      await doctor.setViewportSize({width,height:1000});
      assert.ok(await doctor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Clinician workflow overflows at ${width}`);
    }
    await doctor.getByRole('button',{name:'Accept & update twin',exact:true}).click();
    await doctor.getByRole('status').filter({hasText:'Readings added to the patient record.'}).waitFor();
    const after=await (await doctor.request.get(`${base}/api/patients/HF-0004/timeline?days=90`)).json();
    assert.equal(after.observations.length,before.observations.length+1);
    assert.ok(after.observations.at(-1).submission_id);
    await member.getByRole('button',{name:'Refresh status',exact:true}).click();
    await member.locator('.member-history .accepted').waitFor();
    await member.getByRole('tab',{name:'Upload daily CSV',exact:true}).click();
    const download=member.waitForEvent('download');
    await member.getByRole('button',{name:'Download daily CSV template',exact:true}).click();
    assert.equal((await download).suggestedFilename(),'cardiotwin-daily-summary.csv');
    const next=(await (await member.request.get(`${base}/api/care/member`)).json()).next_date;
    await member.getByLabel('Choose daily-summary CSV',{exact:true}).setInputFiles({name:'daily.csv',mimeType:'text/csv',buffer:Buffer.from(`date,resting_hr,weight\n${next},73,70.2\n`)});
    await member.getByRole('button',{name:'Preview my summary',exact:true}).click();
    await member.getByRole('heading',{name:'Check before sending.'}).waitFor();
    await member.getByRole('button',{name:'Send to care team',exact:true}).click();
    await member.getByRole('status').filter({hasText:'Delivered to your care team.'}).waitFor();
    await doctor.getByRole('button',{name:'Refresh reviews',exact:true}).click();
    await doctor.locator('.submission-row').filter({hasText:'Awaiting review'}).first().click();
    await doctor.getByLabel('Review note',{exact:false}).fill('Please check the weight before resending.');
    await doctor.getByRole('button',{name:'Request correction',exact:true}).click();
    await doctor.getByRole('status').filter({hasText:'Summary returned'}).waitFor();
    await member.getByRole('button',{name:'Refresh status',exact:true}).click();
    await member.getByText('Care team: Please check the weight before resending.',{exact:true}).waitFor();
    await member.getByText('Your sharing choices · 2 signals',{exact:true}).click();
    await member.getByRole('button',{name:'Stop sharing & withdraw pending',exact:true}).click();
    await member.getByRole('heading',{name:'Your sharing has ended.'}).waitFor();
    await member.reload();
    await member.getByRole('heading',{name:'Your sharing has ended.'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Care workflow passed: separate sessions, one-time invite, selected-signal consent, preview, manual and CSV delivery, clinician accept/correction, ledger provenance, member receipt, withdrawal, reload, 360–1440px layouts; zero JS errors.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
