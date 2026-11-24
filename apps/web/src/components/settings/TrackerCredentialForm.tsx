import { useState, type ComponentProps, type ReactNode } from "react";
import type { StandaloneIssueTrackerDescriptor } from "@t3tools/contracts";
import { Input } from "../ui/input";
import { SettingsRow } from "./settingsLayout";
import { SecretInput } from "./SecretInput";

export function TrackerCredentialForm({
  credential,
  onCommit,
  id,
  description,
  action,
  ...props
}: ComponentProps<typeof SecretInput> & {
  readonly credential: StandaloneIssueTrackerDescriptor["credential"];
  readonly id: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <>
      {credential.fields?.map((field) => (
        <SettingsRow
          key={field.key}
          title={<label htmlFor={`${id}-${field.key}`}>{field.label}</label>}
          control={
            <Input
              id={`${id}-${field.key}`}
              size="sm"
              className="w-full min-w-0 @min-[32rem]/settings-row:w-56"
              value={values[field.key] ?? ""}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            />
          }
        />
      ))}
      <SettingsRow
        title={<label htmlFor={id}>{credential.label}</label>}
        description={description}
        control={
          <div className="flex w-full min-w-0 items-center gap-2 @min-[32rem]/settings-row:w-56">
            <SecretInput
              {...props}
              id={id}
              disabled={
                props.disabled || credential.fields?.some((field) => !values[field.key]?.trim())
              }
              onCommit={(token) => {
                if (credential.fields?.some((field) => !values[field.key]?.trim())) return;
                onCommit?.(credential.fields ? JSON.stringify({ ...values, token }) : token);
              }}
            />
            {action}
          </div>
        }
      />
    </>
  );
}
