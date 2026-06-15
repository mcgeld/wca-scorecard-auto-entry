import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const WCA_LIVE_ENDPOINT = 'https://live.worldcubeassociation.org/api/graphql';
const token = process.env.WCA_BEARER_TOKEN;
const competitionId = process.env.WCA_COMPETITION_ID || 'DavisCountyShowdown2026';

async function run() {
  if (!token || token === 'your_wca_bearer_token_here') {
    console.error('Token is missing in .env');
    return;
  }

  // 1. Fetch competition results first to get a valid roundId and resultId
  const getQuery = `
    query GetCompetitionEvents($competitionId: ID!) {
      competition(id: $competitionId) {
        id
        competitionEvents {
          id
          event {
            id
          }
          rounds {
            id
            number
            results {
              id
              person {
                name
                wcaId
              }
            }
          }
        }
      }
    }
  `;

  try {
    console.log('Fetching round results for competition:', competitionId);
    const getRes = await axios.post(
      WCA_LIVE_ENDPOINT,
      { query: getQuery, variables: { competitionId } },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );

    const compEvents = getRes.data.data?.competition?.competitionEvents || [];
    if (compEvents.length === 0) {
      console.log('No events found. Response:', JSON.stringify(getRes.data, null, 2));
      return;
    }

    // Let's find any round and any result to test submit
    const eventObj = compEvents[0];
    const roundObj = eventObj.rounds[0];
    const resultObj = roundObj?.results[0];

    if (!roundObj || !resultObj) {
      console.log('Could not find round or result to test');
      return;
    }

    console.log(`Testing with Round ID: ${roundObj.id}, Result ID: ${resultObj.id} (Competitor: ${resultObj.person.name})`);

    // 2. Try to submit
    const mutation = `
      mutation EnterResults($input: EnterResultsInput!) {
        enterResults(input: $input) {
          round {
            id
          }
        }
      }
    `;

    const variables = {
      input: {
        id: roundObj.id,
        results: [
          {
            id: resultObj.id,
            attempts: [
              { result: 1000 } // 10.00s attempt
            ]
          }
        ]
      }
    };

    console.log('Sending enterResults mutation...');
    const mutationRes = await axios.post(
      WCA_LIVE_ENDPOINT,
      { query: mutation, variables },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );

    console.log('Mutation response:', JSON.stringify(mutationRes.data, null, 2));

  } catch (error) {
    console.error('Error occurred!');
    if (error.response) {
      console.error('Status code:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Message:', error.message);
    }
  }
}

run();
