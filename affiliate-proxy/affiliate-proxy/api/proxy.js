import crypto from 'crypto';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const { action, payload } = await req.json();

    if (action === 'amazon-search') {
      const result = await amazonSearch(payload);
      return json(result);
    }

    return json({ error: 'Unknown action' }, 400);

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function amazonSearch({ query, tag, market }) {
  const accessKey = process.env.AMAZON_ACCESS_KEY;
  const secretKey = process.env.AMAZON_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('Amazon PA API keys not configured on server.');
  }

  const host = 'webservices.' + (market || 'www.amazon.com').replace('www.', '');
  const region = getRegion(market || 'www.amazon.com');
  const path = '/paapi5/searchitems';
  const endpoint = 'https://' + host + path;

  const body = JSON.stringify({
    Keywords: query,
    Resources: [
      'Images.Primary.Large',
      'Images.Primary.Medium',
      'ItemInfo.Title',
      'Offers.Listings.Price',
      'DetailPageURL'
    ],
    PartnerTag: tag,
    PartnerType: 'Associates',
    SearchIndex: 'All',
    ItemCount: 1
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';
  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';

  const canonicalHeaders = [
    'content-encoding:amz-1.0',
    'content-type:application/json; charset=utf-8',
    'host:' + host,
    'x-amz-date:' + amzDate,
    'x-amz-target:' + target,
    ''
  ].join('\n');

  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = [dateStamp, region, 'ProductAdvertisingAPI', 'aws4_request'].join('/');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  const signingKey = getSigningKey(secretKey, dateStamp, region);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-encoding': 'amz-1.0',
      'content-type': 'application/json; charset=utf-8',
      'host': host,
      'x-amz-date': amzDate,
      'x-amz-target': target,
      'Authorization': authHeader
    },
    body
  });

  const data = await res.json();

  if (data.Errors) throw new Error(data.Errors[0]?.Message || 'PA API error');
  if (!data.SearchResult?.Items?.length) return null;

  const item = data.SearchResult.Items[0];
  return {
    imgUrl: item.Images?.Primary?.Large?.URL || item.Images?.Primary?.Medium?.URL || '',
    productUrl: item.DetailPageURL || '',
    price: item.Offers?.Listings?.[0]?.Price?.DisplayAmount || '',
    title: item.ItemInfo?.Title?.DisplayValue || '',
    asin: item.ASIN || ''
  };
}

function getRegion(market) {
  const map = {
    'www.amazon.co.uk': 'eu-west-1',
    'www.amazon.de': 'eu-west-1',
    'www.amazon.fr': 'eu-west-1',
    'www.amazon.it': 'eu-west-1',
    'www.amazon.es': 'eu-west-1',
    'www.amazon.co.jp': 'us-west-2',
    'www.amazon.ca': 'us-east-1',
  };
  return map[market] || 'us-east-1';
}

function getSigningKey(key, dateStamp, region) {
  const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update('ProductAdvertisingAPI').digest();
  return crypto.createHmac('sha256', kService).update('aws4_request').digest();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
