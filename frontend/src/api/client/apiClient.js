import axios from "axios";
import { store } from "../../store";
import {
  startGlobalLoading,
  stopGlobalLoading,
} from "../../store/slices/uiSlice";

const api = axios.create({
  baseURL: "http://localhost:4000/api",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

const shouldTrackGlobalLoader = (config) => !config?.skipGlobalLoader;

api.interceptors.request.use(
  (config) => {
    if (shouldTrackGlobalLoader(config)) {
      store.dispatch(startGlobalLoading());
      config.__trackGlobalLoader = true;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => {
    if (response?.config?.__trackGlobalLoader) {
      store.dispatch(stopGlobalLoading());
    }
    return response;
  },
  (error) => {
    if (error?.config?.__trackGlobalLoader) {
      store.dispatch(stopGlobalLoading());
    }
    return Promise.reject(error);
  },
);

export default api;
