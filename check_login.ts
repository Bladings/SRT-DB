import axios from 'axios';
import * as cheerio from 'cheerio';

async function testScrape() {
  const axiosInstance = axios.create({
    baseURL: 'https://rtraintelligence.com',
  });

  const loginData = new URLSearchParams();
  loginData.append('log', 'test');
  loginData.append('pwd', 'test');
  loginData.append('wp-submit', 'Log In');
  loginData.append('redirect_to', 'https://rtraintelligence.com/publications/');
  loginData.append('jet_login', '1');

  let cookies = [];
  try {
    const res = await axiosInstance.post('/members-area/', loginData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
    });
  } catch (err) {
    if (err.response && err.response.status === 302) {
      cookies = err.response.headers['set-cookie'];
    }
  }

  const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';

  const categories = [
    '/publication-type/deal-news/',
    '/publication-type/pipeline-news/',
    '/publication-type/market-analysis/',
    '/publication-type/regulatory-analysis/'
  ];

  for (const cat of categories) {
    const pubRes = await axiosInstance.get(cat, {
      headers: { Cookie: cookieHeader }
    });
    const $pub = cheerio.load(pubRes.data);
    
    const articles = [];
    $pub('.jet-listing-grid__item').each((i, el) => {
      const url = $pub(el).find('.jet-engine-listing-overlay-link').attr('href');
      const type = $pub(el).find('.jet-listing-dynamic-terms__link').text().trim();
      
      const fields = $pub(el).find('.jet-listing-dynamic-field__content');
      const title = $pub(fields[0]).text().trim();
      let date = $pub(fields[1]).text().trim();
      const summary = $pub(fields[2]).text().trim();
      
      if (date.startsWith('Published: ')) {
        date = date.replace('Published: ', '');
      }
      
      if (title && url) {
        articles.push({ title, url, type, date, summary });
      }
    });
    
    console.log(`Category ${cat} articles found:`, articles.length);
  }
}

testScrape();
