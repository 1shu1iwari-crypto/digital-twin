/* Real-browser integration checks; launch via python -m scripts.verify_browser. */
const { chromium } = require('../frontend/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CARDIOTWIN_BROWSER_EXECUTABLE || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base='http://127.0.0.1:8011';
  await page.goto(base);
  await page.getByRole('heading',{name:'Patient priority queue',exact:false}).waitFor();
  await page.locator('.featured-risk').waitFor();
  await page.screenshot({path:path.join('test-results','overview-desktop.png'),fullPage:true});
  assert.equal(await page.locator('.patient-table tbody tr').count(),32);
  await page.getByRole('button',{name:'Explore digital twin',exact:true}).click();
  await page.getByRole('heading',{name:'Digital twin state'}).waitFor();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export twin',exact:true}).click();
  assert.ok((await downloadPromise).suggestedFilename().endsWith('-synthetic-twin.json'));
  await page.getByRole('button',{name:'Patient overview',exact:true}).click();
  await page.getByRole('textbox',{name:'Search patients'}).fill('HF-0006');
  assert.equal(await page.locator('.patient-table tbody tr').count(),1);
  await page.getByRole('textbox',{name:'Search patients'}).fill('');
  await page.getByRole('combobox',{name:'Filter risk category'}).selectOption('High risk');
  assert.ok(await page.locator('.patient-table tbody tr').count()>0);
  await page.getByRole('combobox',{name:'Filter risk category'}).selectOption('All patients');
  await page.getByRole('button',{name:'Open HF-0004 twin',exact:true}).click();
  await page.getByRole('heading',{name:'Digital twin state'}).waitFor();
  await page.screenshot({path:path.join('test-results','patient-desktop.png'),fullPage:true});
  await page.getByRole('tab',{name:'Explainability',exact:true}).click();
  await page.getByRole('heading',{name:'A traceable estimate.'}).waitFor();
  await page.getByRole('tab',{name:'EHR profile',exact:true}).click();
  await page.getByRole('heading',{name:'Historical patient context'}).waitFor();
  await page.getByRole('tab',{name:'Data timeline',exact:true}).click();
  assert.ok(await page.locator('.patient-table tbody tr').count()>0);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  const before=await (await page.request.get(`${base}/api/patients/HF-0004/timeline`)).json();
  await page.getByRole('button',{name:'Explore a scenario'}).click();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Recompute scenario');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Close dialog');
  await page.getByRole('slider',{name:'Weight change',exact:true}).fill('1');
  await page.getByRole('button',{name:'Recompute scenario'}).click();
  await page.getByRole('status').filter({hasText:'Scenario recomputed.'}).waitFor();
  await page.screenshot({path:path.join('test-results','scenario-desktop.png'),fullPage:true});
  assert.deepEqual(await (await page.request.get(`${base}/api/patients/HF-0004/timeline`)).json(),before);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'Add daily reading'}).click();
  await page.getByRole('button',{name:'Save reading & update twin'}).click();
  await page.getByRole('status').filter({hasText:'Daily reading saved.'}).waitFor();
  const latest=await (await page.request.get(`${base}/api/patients/HF-0004/twin`)).json();
  assert.equal(latest.last_day,36);
  await page.getByRole('button',{name:'Next day',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.replay-bar .primary')?.textContent.includes('Play replay')&&!document.querySelector('.replay-bar .primary')?.disabled);
  await page.getByRole('button',{name:'Play replay',exact:true}).click();
  await page.waitForTimeout(3100);
  await page.getByRole('button',{name:'Pause replay',exact:true}).click();
  const pop=await (await page.request.get(`${base}/api/patients`)).json();
  assert.ok(pop.replay_day>=37);
  await page.getByRole('button',{name:'Model performance',exact:true}).click();
  await page.getByRole('heading',{name:'What does personalization add?'}).waitFor();
  assert.equal(await page.locator('.evaluation-table tbody tr').count(),6);
  await page.screenshot({path:path.join('test-results','evaluation-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Research & methods',exact:true}).click();
  await page.getByRole('heading',{name:'Understand an ordinary day.',exact:false}).waitFor();
  await page.screenshot({path:path.join('test-results','research-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Patient overview',exact:true}).click();
  await page.screenshot({path:path.join('test-results','overview-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByRole('button',{name:'Digital twin',exact:true}).click();
  await page.getByRole('heading',{name:'Digital twin state'}).waitFor();
  await page.screenshot({path:path.join('test-results','patient-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByRole('button',{name:'Explore a scenario'}).click();
  await page.waitForTimeout(300);
  await page.screenshot({path:path.join('test-results','scenario-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.keyboard.press('Escape');
  for (const width of [360,768,1024,1440]) {
    await page.setViewportSize({width,height:960});
    for (const label of ['Patient overview','Digital twin','Model performance','Research & methods']) {
      await page.getByRole('button',{name:label,exact:true}).click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${label} overflows at ${width}px`);
      if(label==='Digital twin') {
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
