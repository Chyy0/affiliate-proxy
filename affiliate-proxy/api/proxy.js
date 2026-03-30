async function amazonSearch({ query, tag, market }) {
  const accessKey = process.env.AMAZON_ACCESS_KEY;
  const secretKey = process.env.AMAZON_SECRET_KEY;
  if (!accessKey || !secretKey) throw new Error('Amazon keys not set in Vercel env vars');

  const resolvedMarket = market || 'www.amazon.com';
  const host = 'webservices.' + resolvedMarket.replace('www.', '');
  const region = getRegion(resolvedMarket);
  const path = '/paapi5/searchitems';
  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';

  const body = JSON.stringify({
    Keywords: query,
    Resources: [
      'Images.Primary.Large',
      'Images.Primary.Medium',
      'ItemInfo.Title',
      'Offers.Listings.Price'
    ],
    PartnerTag: tag,
    PartnerType: 'Associates',
    SearchIndex: 'All',
    ItemCount: 5 // 🔥 FIX: get more results
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const canonicalHeaders =
    'content-encoding:amz-1.0\n' +
    'content-type:application/json; charset=utf-8\n' +
    'host:' + host + '\n' +
    'x-amz-date:' + amzDate + '\n' +
    'x-amz-target:' + target + '\n';

  const payloadHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = [dateStamp, region, 'ProductAdvertisingAPI', 'aws4_request'].join('/');
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope,
    crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
  ].join('\n');

  const signingKey = getSigningKey(secretKey, dateStamp, region);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const authHeader = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const apiRes = await fetch('https://' + host + path, {
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

  const rawText = await apiRes.text();
  console.log('PA API status:', apiRes.status, rawText.slice(0, 400));

  const data = JSON.parse(rawText);

  if (data.Errors && data.Errors.length) {
    throw new Error(data.Errors[0].Message + ' (' + data.Errors[0].Code + ')');
  }

  const items = data?.SearchResult?.Items || [];
  if (!items.length) return null;

  // ✅ FIX: map ALL items + filter
  const products = items
    .map(item => ({
      imgUrl: item.Images?.Primary?.Large?.URL ||
              item.Images?.Primary?.Medium?.URL || '',
      productUrl: item.DetailPageURL ||
        ('https://' + resolvedMarket + '/dp/' + item.ASIN + '?tag=' + tag),
      price: item.Offers?.Listings?.[0]?.Price?.DisplayAmount || '',
      title: item.ItemInfo?.Title?.DisplayValue || '',
      asin: item.ASIN || ''
    }))
    .filter(p => p.imgUrl && p.title); // 🔥 remove junk

  if (!products.length) return null;

  return products; // 🔥 RETURN ARRAY (not single item)
}
