import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testExtract() {
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

  // Fetch a specific article
  const url = 'https://rtraintelligence.com/publications/further-mergers-eyed/';
  const res = await axiosInstance.get(url, { headers: { Cookie: cookieHeader } });
  const $ = cheerio.load(res.data);
  
  // Try to find the main content
  const content = $('.elementor-widget-theme-post-content').text().trim() || $('.entry-content').text().trim() || $('main').text().trim();
  console.log('Content length:', content.length);
  console.log('Content preview:', content.substring(0, 200));
  
  // Use Gemini to extract structured data
  const prompt = `
  Extract the following information from the article text.
  If a field is not mentioned, leave it empty or null.
  
  Article Text:
  ${content}
  `;
  
  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          MONTH: { type: Type.STRING },
          YEAR: { type: Type.STRING },
          "TRANSACTION NAME": { type: Type.STRING },
          ORIGINATOR: { type: Type.STRING },
          "TRANCHE TYPE": { type: Type.STRING },
          CURRENCY: { type: Type.STRING },
          "TRANCHE AMOUNT (millions)": { type: Type.NUMBER },
          "ATTACHMENT POINT (%)": { type: Type.NUMBER },
          "DETACHMENT POINT (%)": { type: Type.NUMBER },
          PRICING: { type: Type.STRING },
          "PORTFOLIO SIZE (millions)": { type: Type.NUMBER },
          "ASSET CLASS": { type: Type.STRING },
          JURISDICTION: { type: Type.STRING },
          "PORTFOLIO WAL": { type: Type.STRING },
          "PORTFOLIO/CAPITAL CALCULATION APPROACH": { type: Type.STRING },
          "AMORTIZATION STRUCTURE": { type: Type.STRING },
          "DEAL STRUCTURE": { type: Type.STRING },
          "BILATERAL/SYNDICATED": { type: Type.STRING },
          "EXCESS SPREAD": { type: Type.STRING },
          "NUMBER OF BORROWERS": { type: Type.NUMBER },
          "CALL DATE": { type: Type.STRING },
          STS: { type: Type.STRING },
          INVESTOR: { type: Type.STRING },
          ARRANGER: { type: Type.STRING },
        }
      }
    }
  });
  
  console.log('Extracted Data:', response.text);
}

testExtract();
