import { useEffect } from "react";
import { useKitCart } from "cart-kit";

/** A hook from a package: stateward does not read it, and says nothing. */
export function KitPage() {
  const { save, items } = useKitCart();
  useEffect(() => {
    void save();
  }, [save, items]);
  return <p>{items.length}</p>;
}
