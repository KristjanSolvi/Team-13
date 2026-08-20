import type { CortiDictation } from "@corti/dictation-web";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "corti-dictation": DetailedHTMLProps<HTMLAttributes<CortiDictation>, CortiDictation>;
    }
  }
}
