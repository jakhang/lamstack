import axios from 'axios';
import { axiosAdapter } from './axios.adapter';
import { runAdapterContract } from './contract.test-kit';

runAdapterContract('axios', () => axiosAdapter(axios.create()));
