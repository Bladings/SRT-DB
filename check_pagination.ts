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
    '/publication-type/pipeline-news/',
    '/publication-type/market-analysis/',
    '/publication-type/regulatory-analysis/'
  ];

  for (const cat of categories) {
    const url = `${cat}?jsf=jet-engine:allpublication&pagenum=2`;
    console.log(`Fetching ${url}`);
    
    const pubRes = await axiosInstance.get(url, {
      headers: { Cookie: cookieHeader }
    });
    const $pub = cheerio.load(pubRes.data);
    
    const articles = [];
    $pub('.jet-listing-grid__item').each((i, el) => {
      const articleUrl = $pub(el).find('.jet-engine-listing-overlay-link').attr('href');
      const title = $pub(el).find('.jet-listing-dynamic-field__content').first().text().trim();
      
      if (title && articleUrl) {
        articles.push({ title });
      }
    });
    
    console.log(`Category ${cat} Page 2 articles found:`, articles.length);
    if (articles.length > 0) {
      console.log(`First article: ${articles[0].title}`);
    }
  }
}

testScrape();
