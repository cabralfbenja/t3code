import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { TrackerCredentialForm } from "./TrackerCredentialForm";

it("requires the instance fields and submits them with the secret on Enter", async () => {
  const commit = vi.fn();
  await using screen = await render(
    <TrackerCredentialForm
      id="credential"
      credential={{
        label: "API token",
        helpUrl: null,
        fields: [
          { key: "name", label: "Name" },
          { key: "baseUrl", label: "Base URL" },
        ],
      }}
      value=""
      aria-label="API token"
      onCommit={commit}
    />,
  );
  const token = screen.getByLabelText("API token");
  await expect.element(token).toBeDisabled();
  await userEvent.fill(screen.getByLabelText("Name"), "Internal");
  await expect.element(token).toBeDisabled();
  await userEvent.fill(screen.getByLabelText("Base URL"), "https://tracker.test/t3/v1");
  await expect.element(token).toBeEnabled();
  await userEvent.fill(token, "test-token");
  await userEvent.keyboard("{Enter}");
  expect(commit).toHaveBeenCalledWith(
    JSON.stringify({
      name: "Internal",
      baseUrl: "https://tracker.test/t3/v1",
      token: "test-token",
    }),
  );
});

it("keeps unstructured credentials as the original bare token", async () => {
  const commit = vi.fn();
  await using screen = await render(
    <TrackerCredentialForm
      id="credential"
      credential={{ label: "API token", helpUrl: null }}
      value=""
      aria-label="API token"
      onCommit={commit}
    />,
  );
  await userEvent.fill(screen.getByLabelText("API token"), "test-token");
  await userEvent.keyboard("{Enter}");
  expect(commit).toHaveBeenCalledWith("test-token");
});
