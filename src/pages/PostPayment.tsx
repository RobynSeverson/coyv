import { useSearchParams } from "react-router-dom";
import OrderStatus from "./OrderStatus";
import SubscriptionStatus from "./SubscriptionStatus";

/* Stripe returns to a single URL after confirming a payment, whether that
   payment was a one-off order or the first invoice of a subscription. Choosing
   the page in a wrapper keeps each of them a plain component with its own
   hooks, rather than one component branching halfway through. */
export default function PostPayment() {
  const [params] = useSearchParams();

  return params.get("subscription") === "1" ? <SubscriptionStatus /> : <OrderStatus />;
}
