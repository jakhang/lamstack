import { fetchAdapter } from './fetch.adapter';
import { runAdapterContract } from './contract.test-kit';

runAdapterContract('fetch', () => fetchAdapter());
