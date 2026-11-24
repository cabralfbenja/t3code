import { useState, type ComponentProps } from "react";
import type { StandaloneIssueTrackerDescriptor } from "@t3tools/contracts";
import { Input } from "../ui/input";
import { SecretInput } from "./SecretInput";

export function TrackerCredentialInput({
  credential,
  onCommit,
  ...props
}: ComponentProps<typeof SecretInput> & {
  readonly credential: StandaloneIssueTrackerDescriptor["credential"];
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="grid w-full min-w-0 gap-2">
      {credential.fields?.map((field) => (
        <label key={field.key} className="grid gap-1 text-xs">
          {field.label}
          <Input
            value={values[field.key] ?? ""}
            onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
          />
        </label>
      ))}
      <SecretInput
        {...props}
        disabled={props.disabled || credential.fields?.some((field) => !values[field.key]?.trim())}
        onCommit={(token) => {
          if (credential.fields?.some((field) => !values[field.key]?.trim())) return;
          onCommit?.(credential.fields ? JSON.stringify({ ...values, token }) : token);
        }}
      />
    </div>
  );
}
