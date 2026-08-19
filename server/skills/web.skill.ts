import type { SkillRoute } from './types.js';

export const webSkills: SkillRoute[] = [
  {
    id: 'web.research',
    domain: 'web',
    intents: ['search', 'question', 'research'],
    description: 'Search the web for information, weather, facts',
    triggers: ['search', 'find', 'look up', 'google', 'what is', 'weather', 'how do', 'tell me about', 'latest', 'news', 'current'],
    negativeTriggers: ['open a website', 'click', 'fill out', 'navigate to', 'browse', 'interact with', 'weather in', 'weather for', 'forecast'],
    risk: 'read',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Search query is valid.',
        onFailure: 'Ask the user what they want to search for.',
      },
      {
        id: 'search',
        action: 'tool',
        tool: 'webSearch',
        argsBuilder: (ctx) => ({
          query: ctx.query,
          numResults: ctx.numResults,
        }),
        required: true,
        onSuccess: 'Results found.',
        onFailure: 'Report the search error.',
      },
      {
        id: 'respond',
        action: 'respond',
        onSuccess: 'Summarize the search results.',
      },
    ],
    successCriteria: [
      { name: 'results_found', description: 'Search returned at least one result' },
    ],
    outputMode: 'text',
  },
  {
    id: 'web.weather',
    domain: 'web',
    intents: ['question', 'read'],
    description: 'Get current weather or forecast for a location',
    triggers: ['weather', 'forecast', 'raining', 'temperature', 'humidity', 'is it sunny', 'climate'],
    negativeTriggers: ['search', 'look up', 'find', 'news', 'documentation', 'latest'],
    risk: 'read',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Location is specified.',
        onFailure: 'Ask which location.',
      },
      {
        id: 'weather',
        action: 'tool',
        tool: 'getWeather',
        argsBuilder: (ctx) => ({
          location: ctx.location,
        }),
        required: true,
        onSuccess: 'Weather data returned.',
        onFailure: 'Report the weather service error.',
      },
      { id: 'respond', action: 'respond' },
    ],
    successCriteria: [
      { name: 'weather_reported', description: 'Weather data was returned for the location' },
    ],
    outputMode: 'text',
  },
  {
    id: 'web.browser_action',
    domain: 'browser',
    intents: ['execute', 'control'],
    description: 'Control a headless browser: navigate, click, read pages',
    triggers: ['open', 'navigate to', 'click', 'browse', 'go to', 'visit', 'fill out', 'submit', 'scroll', 'interact with the page'],
    negativeTriggers: ['search for', 'find', 'look up', 'what is', 'weather'],
    risk: 'execute',
    steps: [
      {
        id: 'validate',
        action: 'validate',
        required: true,
        onSuccess: 'Browser action is valid.',
        onFailure: 'Ask what the user wants to do in the browser.',
      },
      {
        id: 'execute',
        action: 'tool',
        tool: 'runBrowserAutomation',
        argsBuilder: (ctx) => ({
          action: ctx.action,
          url: ctx.url,
          selector: ctx.selector,
          value: ctx.value,
        }),
        required: true,
        onSuccess: 'Browser action completed.',
        onFailure: 'Report the browser error.',
      },
      {
        id: 'respond',
        action: 'respond',
        onSuccess: 'Show the result of the browser action.',
      },
    ],
    outputMode: 'text',
  },
];

export default webSkills;
