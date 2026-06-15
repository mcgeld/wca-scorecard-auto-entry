import https from 'https';
import fs from 'fs';

const query = JSON.stringify({
  query: `
    query IntrospectResult {
      __type(name: "Result") {
        name
        fields {
          name
          type {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  `
});

const options = {
  hostname: 'live.worldcubeassociation.org',
  port: 443,
  path: '/api/graphql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(query),
    'User-Agent': 'Mozilla/5.0'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    fs.writeFileSync('C:/Users/malco/Documents/CubingDataEntry/result_type_details.json', data);
    console.log('Successfully wrote result_type_details.json');
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(query);
req.end();
