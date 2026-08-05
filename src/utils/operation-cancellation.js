export const USER_CANCELLED_EXIT_CODE = 130;

export function isAbortLikeError(error) {
  if (!error) {
    return false;
  }

  if (
    error?.name === "AbortError" ||
    error?.name === "APIUserAbortError" ||
    error?.code === "ABORT_ERR"
  ) {
    return true;
  }

  return false;
}

export function bindCtrlCCancellation({
  signalProcess = process,
  onCancel
} = {}) {
  const handler = () => {
    onCancel?.();
  };

  signalProcess.on("SIGINT", handler);
  return () => {
    signalProcess.off("SIGINT", handler);
  };
}

export function createCancellationController({
  signalProcess = process,
  cancelMessage = "Cancelled by Ctrl+C."
} = {}) {
  const controller = new AbortController();
  const unbind = bindCtrlCCancellation({
    signalProcess,
    onCancel: () => {
      if (!controller.signal.aborted) {
        const error = new Error(cancelMessage);
        error.name = "AbortError";
        controller.abort(error);
      }
    }
  });

  return {
    controller,
    cleanup: unbind
  };
}
