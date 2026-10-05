// Teste de fumaça da interface (Playwright): cria um projeto pela UI, sobe um
// vídeo, espera o processamento, abre o editor, toca o preview e faz uma edição.
//   BASE=http://localhost:3000 node scripts/smoke-ui.mjs <video.mp4> <pasta-screenshots>
import {chromium} from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const [video, out = '.'] = process.argv.slice(2);
const SCRIPT = 'Hoje eu vou te mostrar como a inteligência artificial pode triplicar suas vendas. Em 30 dias, nossos clientes cresceram 87%. O segredo não é trabalhar mais. São três coisas: conteúdo, constância, automação. Isso muda o jogo do seu negócio. Segue para mais dicas!';

const browser = await chromium.launch({executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(BASE);
await page.getByRole('button', {name: '+ Novo vídeo'}).click();
await page.locator('input[type=file][accept="video/*"]').setInputFiles(video);
await page.getByPlaceholder('Meu reel').fill('Teste UI');
await page.getByPlaceholder('Cole aqui o texto').fill(SCRIPT);
await page.screenshot({path: `${out}/01-novo.png`});
await page.getByRole('button', {name: 'Criar e processar'}).click();
await page.waitForURL(/\/projects\//, {timeout: 60000});
await page.waitForTimeout(1500);
await page.screenshot({path: `${out}/02-processando.png`});
await page.getByText('Salvo').first().waitFor({timeout: 180000});
await page.waitForTimeout(2500);
await page.screenshot({path: `${out}/03-editor.png`});

// toca 2 s
await page.keyboard.press('Space');
await page.waitForTimeout(2000);
await page.keyboard.press('Space');
await page.screenshot({path: `${out}/04-tocando.png`});

// seleciona o primeiro gráfico na timeline e muda o valor
const ov = page.locator('div[title]').filter({hasText: '%'}).first();
if (await ov.count()) {
  await ov.click();
  await page.waitForTimeout(800);
  await page.screenshot({path: `${out}/05-grafico.png`});
}
// adiciona um título na agulha
await page.keyboard.press('Escape');
await page.getByRole('button', {name: '+ Título'}).click();
await page.waitForTimeout(1000);
await page.screenshot({path: `${out}/06-titulo.png`});
await page.getByText('Salvo').first().waitFor({timeout: 15000});
console.log('erros no console:', errors.length ? errors.slice(0, 10) : 'nenhum');
await browser.close();
