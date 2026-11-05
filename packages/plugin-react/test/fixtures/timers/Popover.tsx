import React from "react";
import { Layer } from "./layer.js";

/** `React.useRef`, and the callback is a function of the component that reads a context value. */
export const Popover = React.memo(function Popover({ text }: { text: string }) {
  const [visible, setVisible] = React.useState(false);
  const layer = React.useContext(Layer);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = () => {
    setVisible(false);
    layer.release();
  };
  const scheduleHide = () => {
    hideTimer.current = setTimeout(hide, 300);
  };
  return (
    <div onMouseLeave={scheduleHide} onMouseEnter={() => setVisible(true)}>
      {visible ? text : null}
    </div>
  );
});
