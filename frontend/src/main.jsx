import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { Toaster } from "sonner";
import App from "./App";
import { DeleteConfirmProvider } from "./components/common/DeleteConfirmProvider";
import { store } from "./store";
import GlobalApiLoader from "./components/Loaders/GlobalApiLoader";
import "./App.css";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <DeleteConfirmProvider>
          <BrowserRouter>
            <GlobalApiLoader />
            <Toaster
              position="top-center"
              duration={3000}
              closeButton={false}
              visibleToasts={1}
              toastOptions={{
                // no icon, tight layout
                unstyled: false,
                className:
                  "!bg-black !text-white !rounded-full px-4 py-2 shadow-2xl",
                // remove icons globally
                icon: null,
              }}
            />

            <App />
            {/* <ReactQueryDevtools initialIsOpen={false} 
            position="bottom-right"
             /> */}
          </BrowserRouter>
        </DeleteConfirmProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>,
);
