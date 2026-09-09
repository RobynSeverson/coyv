import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CartProvider } from "./cart/CartContext";
import SiteLayout from "./components/SiteLayout";
import { ADMIN_PATH } from "./config";
import Landing from "./pages/Landing";
import Home from "./pages/Home";
import Memories from "./pages/Memories";
import Vault from "./pages/Vault";
import Checkout from "./pages/Checkout";
import OrderStatus from "./pages/OrderStatus";

/* The admin panel pulls in its own screens and is useless to a visitor, so it
   is split out of the main bundle. */
const AdminApp = lazy(() => import("./pages/admin/AdminApp"));

export default function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <Routes>
          <Route path="/" element={<Landing />} />

          <Route
            path={ADMIN_PATH}
            element={
              <Suspense fallback={null}>
                <AdminApp />
              </Suspense>
            }
          />

          <Route element={<SiteLayout />}>
            <Route path="/home" element={<Home />} />
            <Route path="/vault" element={<Vault />} />
            {/* The shop used to live here; keep shared links working. */}
            <Route path="/prints" element={<Navigate to="/vault" replace />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/order" element={<OrderStatus />} />
            <Route path="/memories" element={<Memories />} />
          </Route>
        </Routes>
      </CartProvider>
    </BrowserRouter>
  );
}
