const { chromium } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };
const files = new Set(['/index.html','/styles.css','/app.js','/assets/favicon.svg']);
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? '/index.html' : req.url;
  if (!files.has(name)) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'Content-Type': types[path.extname(name)]+'; charset=UTF-8'});
  res.end(fs.readFileSync(path.join(__dirname,name)));
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
  try {
    for (const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow',320,660]]) {
      const page = await browser.newPage({viewport:{width,height},reducedMotion:'reduce',hasTouch:name!=='desktop'});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      const input = page.getByRole('textbox',{ name:'Новая задача' });
      assert(await page.getByText('Начните с малого').isVisible());
      assert(await page.locator('#task-form').evaluate(ele => ele.getBoundingClientRect().bottom <= innerHeight));
      await input.fill('  Подготовить презентацию  ');
      await input.press('Enter');
      await input.fill('Проверить мобильную версию');
      await page.getByRole('button',{name:'Добавить'}).click();
      await page.getByRole('button',{name:'Отметить выполненной: Подготовить презентацию'}).click();
      await page.reload();
      assert.equal(await page.locator('.task-item').count(),2);
      assert.equal(await page.locator('#progress-percent').textContent(),'50%');
      await page.getByRole('button',{name:'Выполненные',exact:true}).click();
      assert.equal(await page.locator('.task-item').count(),1);
      await input.fill('Составить список на неделю');
      await input.press('Enter');
      assert.equal(await page.locator('.task-item').count(),3);
      assert(await page.getByRole('button',{name:'Все 3',exact:true}).getAttribute('aria-pressed')==='true');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if (process.env.UPDATE_SCREENSHOTS === '1' && name !== 'narrow') {
        await input.blur();
        await page.screenshot({path:path.join(__dirname,'assets','preview-'+name+'.png'),fullPage:true});
      }
      await page.getByRole('button',{name:'Удалить задачу: Составить список на неделю'}).click();
      assert.equal(await page.locator('.task-item').count(),2);
      await page.getByRole('button',{name:'Отменить'}).click();
      assert.equal(await page.locator('.task-item').count(),3);
      await page.getByRole('button',{name:'Удалить задачу: Составить список на неделю'}).click();
      await page.reload();
      assert.equal(await page.locator('.task-item').count(),2);
      await page.getByRole('button',{name:'Очистить выполненные'}).click();
      assert.equal(await page.locator('.task-item').count(),1);
      assert.deepEqual(errors,[]);
      await page.close();
      console.log('PASS '+name+' '+width+'px');
    }
  } finally { await browser.close(); }
}
run().catch(error=>{ console.error(error); process.exitCode=1; }).finally(()=>server.close());
