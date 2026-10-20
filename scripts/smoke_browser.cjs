/* Real-browser integration checks; launch via python -m scripts.verify_browser. */
const { chromium } = require('../frontend/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CARDIOTWIN_BROWSER_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  page.setDefaultTimeout(60000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base='http://127.0.0.1:8011';
  await page.goto(base, {waitUntil: 'networkidle'});
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.overview-grid').waitFor();
  await page.locator('.focus-risk-block').waitFor();
  const snap = (name) => page.screenshot({path:path.join('test-results',name),fullPage:true,animations:'disabled',timeout:60000});
  const navigate = async (label) => {
    const buttons=page.getByRole('button',{name:label,exact:true});
    for(let index=0;index<await buttons.count();index++) {
      if(await buttons.nth(index).isVisible())return buttons.nth(index).click();
    }
    throw new Error(`No visible navigation control named ${label}`);
  };
  await snap('overview-desktop.png');
  assert.equal(await page.locator('.overview-grid .data-table tbody tr').count(),32);
  await page.getByRole('button',{name:'Open patient twin',exact:true}).click();
  await page.getByText('Digital twin state',{exact:true}).waitFor();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export',exact:true}).click();
  assert.ok((await downloadPromise).suggestedFilename().endsWith('-synthetic-twin.json'));
  await navigate('Overview');
  await page.getByRole('textbox',{name:'Search patients'}).fill('HF-0006');
  assert.equal(await page.locator('.overview-grid .data-table tbody tr').count(),1);
  await page.getByRole('textbox',{name:'Search patients'}).fill('');
  await page.getByRole('combobox',{name:'Filter by category'}).selectOption('High risk');
  assert.ok(await page.locator('.overview-grid .data-table tbody tr').count()>0);
  await page.getByRole('combobox',{name:'Filter by category'}).selectOption('All patients');
  await page.getByRole('button',{name:'Open HF-0004',exact:true}).click();
  await page.getByText('Digital twin state',{exact:true}).waitFor();
  await snap('patient-desktop.png');
  await page.getByRole('tab',{name:'Explainability',exact:true}).click();
  await page.getByText('A traceable estimate',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'EHR profile',exact:true}).click();
  await page.getByText('Historical patient context',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'Data timeline',exact:true}).click();
  assert.ok(await page.locator('.data-table tbody tr').count()>0);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  const before=await (await page.request.get(`${base}/api/patients/HF-0004/timeline`)).json();
  await page.getByRole('button',{name:'Scenario',exact:true}).click();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Recompute scenario');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Close');
  await page.getByRole('slider',{name:'Weight change',exact:true}).fill('1');
  await page.getByRole('button',{name:'Recompute scenario'}).click();
  await page.getByRole('status').filter({hasText:'Scenario recomputed.'}).waitFor();
  await snap('scenario-desktop.png');
  assert.deepEqual(await (await page.request.get(`${base}/api/patients/HF-0004/timeline`)).json(),before);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('banner').getByRole('button',{name:'Add reading',exact:true}).click();
  await page.getByRole('button',{name:"Copy yesterday's values",exact:true}).click();
  await page.getByRole('button',{name:'Save reading & update twin'}).click();
  await page.getByRole('status').filter({hasText:'Daily reading saved.'}).waitFor();
  const latest=await (await page.request.get(`${base}/api/patients/HF-0004/twin`)).json();
  assert.equal(latest.last_day,36);
  await page.getByRole('button',{name:'Next day',exact:true}).click();
  await page.waitForFunction(()=>{
    const button=[...document.querySelectorAll('button')].find(item=>item.getAttribute('title')==='Play replay');
    return button&&!button.disabled;
  });
  await page.getByRole('button',{name:'Play replay',exact:true}).click();
  await page.waitForTimeout(3100);
  await page.getByRole('button',{name:'Pause replay',exact:true}).click();
  const pop=await (await page.request.get(`${base}/api/patients`)).json();
  assert.ok(pop.replay_day>=37);
  await navigate('Model Evidence');
  await page.getByText('What does personalization add?',{exact:true}).waitFor();
  assert.equal(await page.locator('.evaluation-table tbody tr').count(),6);
  await snap('evaluation-desktop.png');
  await navigate('Research');
  await page.getByRole('heading',{name:'Understand an ordinary day.',exact:false}).waitFor();
  await snap('research-desktop.png');
  await navigate('Device Connections');
  await page.getByText('Supported wearable ecosystems',{exact:true}).waitFor();
  await snap('connections-desktop.png');
  await page.setViewportSize({width:390,height:844});
  await navigate('Overview');
  await snap('overview-mobile.png');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await navigate('Patient Twin');
  await page.getByText('Digital twin state',{exact:true}).waitFor();
  await snap('patient-mobile.png');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByRole('button',{name:'Scenario',exact:true}).click();
  await page.waitForTimeout(300);
  await snap('scenario-mobile.png');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.keyboard.press('Escape');
  for (const width of [360,768,1024,1440]) {
    await page.setViewportSize({width,height:960});
    for (const label of ['Overview','Patient Twin','Device Connections','Model Evidence','Research']) {
      await navigate(label);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${label} overflows at ${width}px`);
      if(label==='Patient Twin') {
        for(const tab of ['Explainability','EHR profile','Data timeline','Overview']) {
          await page.getByRole('tab',{name:tab,exact:true}).click();
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${tab} overflows at ${width}px`);
        }
      }
    }
  }
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('Browser smoke passed: search, filter, patient tabs, scenario, ingestion, replay, evaluation, research, 360–1440px layouts, drawer focus trap; zero JS errors.');
})().catch(error=>{console.error(error);process.exit(1)});
