"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Group, Image as KonvaImage, Label, Layer, Rect, Stage, Tag, Text, Transformer } from "react-konva";
import type Konva from "konva";

type ModelChoice = "with_medclip" | "without_medclip";

type Detection = {
  id: string;
  label: string;
  confidence?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  original: Record<string, unknown>;
};

type PredictResponse = {
  predictionId: string;
  model: ModelChoice;
  threshold: number;
  detections: Record<string, unknown>[];
};

type SavedPredictionSummary = {
  id: string;
  originalFileName: string;
  model: string;
  threshold: number;
  detectionCount: number;
  updatedAt?: string;
};

type SavedPredictionDetail = {
  id: string;
  originalFileName: string;
  model: string;
  threshold: number;
  detections: Record<string, unknown>[];
  imageDataUrl: string;
};

const modelLabels: Record<ModelChoice, string> = {
  with_medclip: "With MedCLIP",
  without_medclip: "Without MedCLIP",
};

const diseaseColors: Record<string, string> = {
  Osteophytes: "#e11d48",
  "Disc space narrowing": "#2563eb",
  "Other lesions": "#7c3aed",
  "Surgical implant": "#ea580c",
  "Foraminal stenosis": "#059669",
  "Vertebral collapse": "#ca8a04",
};

const fallbackColor = "#0f766e";

function numberFrom(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumberFrom(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function detectionLabel(raw: Record<string, unknown>) {
  return String(
    raw.disease ??
      raw.label ??
      raw.class ??
      raw.className ??
      raw.name ??
      raw.category ??
      "finding"
  );
}

function normalizeDetection(raw: Record<string, unknown>, index: number): Detection {
  const source = (raw.bbox ?? raw.box ?? raw) as Record<string, unknown> | unknown[];
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;

  if (Array.isArray(source)) {
    x = numberFrom(source[0]);
    y = numberFrom(source[1]);
    const third = numberFrom(source[2]);
    const fourth = numberFrom(source[3]);
    width = third > x ? third - x : third;
    height = fourth > y ? fourth - y : fourth;
  } else {
    const box = source as Record<string, unknown>;
    const x1 = numberFrom(box.xmin ?? box.x1 ?? box.left ?? box.x);
    const y1 = numberFrom(box.ymin ?? box.y1 ?? box.top ?? box.y);
    const x2 = numberFrom(box.xmax ?? box.x2 ?? box.right);
    const y2 = numberFrom(box.ymax ?? box.y2 ?? box.bottom);
    x = x1;
    y = y1;
    width = numberFrom(box.width ?? box.w, x2 ? x2 - x1 : 0);
    height = numberFrom(box.height ?? box.h, y2 ? y2 - y1 : 0);
  }

  return {
    id: String(raw.id ?? `${index}-${detectionLabel(raw)}`),
    label: detectionLabel(raw),
    confidence: optionalNumberFrom(raw.confidence ?? raw.score),
    x,
    y,
    width: Math.max(width, 12),
    height: Math.max(height, 12),
    original: raw,
  };
}

function toSavedDetection(detection: Detection) {
  return {
    ...detection.original,
    disease: detection.label,
    label: detection.label,
    confidence: detection.confidence,
    bbox: {
      xmin: Math.round(detection.x * 100) / 100,
      ymin: Math.round(detection.y * 100) / 100,
      xmax: Math.round((detection.x + detection.width) * 100) / 100,
      ymax: Math.round((detection.y + detection.height) * 100) / 100,
    },
  };
}

function detectionColor(label: string) {
  return diseaseColors[label] ?? fallbackColor;
}

function confidenceText(confidence?: number) {
  return typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : "n/a";
}

function detectionCaption(detection: Detection) {
  return `${detection.label} ${confidenceText(detection.confidence)}`;
}

function loadImageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new window.Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = reject;
    nextImage.src = url;
  });
}

export default function PredictionWorkspace() {
  const { data: session, status } = useSession();
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [model, setModel] = useState<ModelChoice>("with_medclip");
  const [threshold, setThreshold] = useState(0.25);
  const [predictionId, setPredictionId] = useState("");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [hoveredId, setHoveredId] = useState("");
  const [message, setMessage] = useState("");
  const [isPredicting, setIsPredicting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPredictions, setSavedPredictions] = useState<SavedPredictionSummary[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const rectRefs = useRef<Record<string, Konva.Rect | null>>({});
  const [stageWidth, setStageWidth] = useState(760);

  useEffect(() => {
    const updateWidth = () => {
      setStageWidth(stageWrapRef.current?.clientWidth ?? 760);
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (!file) return;

    let isActive = true;
    const reader = new FileReader();
    reader.onload = async () => {
      const url = String(reader.result ?? "");
      if (!url || !isActive) return;
      setImageDataUrl(url);
      try {
        const loadedImage = await loadImageFromUrl(url);
        if (isActive) setImage(loadedImage);
      } catch {
        if (isActive) setImage(null);
      }
    };
    reader.readAsDataURL(file);

    return () => {
      isActive = false;
    };
  }, [file]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const selectedNode = selectedId ? rectRefs.current[selectedId] : null;
    if (!transformer) return;
    transformer.nodes(selectedNode ? [selectedNode] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, detections]);

  const loadSavedPredictions = async () => {
    setIsLoadingSaved(true);
    const response = await fetch("/api/predictions");
    const result = (await response.json()) as {
      message?: string;
      predictions?: SavedPredictionSummary[];
    };
    setIsLoadingSaved(false);

    if (!response.ok) {
      setMessage(result.message ?? "Could not load saved results.");
      return;
    }

    setSavedPredictions(result.predictions ?? []);
  };

  useEffect(() => {
    if (!session?.user?.email) return;

    let isActive = true;

    fetch("/api/predictions")
      .then(async (response) => {
        const result = (await response.json()) as {
          predictions?: SavedPredictionSummary[];
        };
        if (isActive && response.ok) {
          setSavedPredictions(result.predictions ?? []);
        }
      })
      .catch(() => {
        if (isActive) setSavedPredictions([]);
      });

    return () => {
      isActive = false;
    };
  }, [session?.user?.email]);

  const stageSize = useMemo(() => {
    if (!image) return { width: stageWidth, height: 430, scale: 1 };
    const scale = Math.min(stageWidth / image.naturalWidth, 680 / image.naturalHeight, 1);
    return {
      width: Math.round(image.naturalWidth * scale),
      height: Math.round(image.naturalHeight * scale),
      scale,
    };
  }, [image, stageWidth]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setAuthError("Login failed. Check email and password.");
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");
    setIsRegistering(true);

    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const result = (await response.json()) as { message?: string };

    setIsRegistering(false);

    if (!response.ok) {
      setAuthError(result.message ?? "Register failed.");
      return;
    }

    setAuthMode("login");
    setAuthMessage("Register success. You can login now.");
  };

  const handlePredict = async () => {
    if (!file) {
      setMessage("Please upload an X-ray image first.");
      return;
    }

    setIsPredicting(true);
    setMessage("");
    setPredictionId("");
    setDetections([]);
    setSelectedId("");
    setHoveredId("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", model);
    formData.append("threshold", String(threshold));

    const response = await fetch("/api/predict", {
      method: "POST",
      body: formData,
    });
    const result = (await response.json()) as PredictResponse | { message?: string };

    setIsPredicting(false);

    if (!response.ok) {
      setMessage("message" in result ? result.message ?? "Prediction failed." : "Prediction failed.");
      return;
    }

    const data = result as PredictResponse;
    const rawDetections = Array.isArray(data.detections) ? data.detections : [];
    setPredictionId(String(data.predictionId));
    setDetections(rawDetections.map(normalizeDetection));
    setSelectedId("");
    setHoveredId("");
    setMessage(`Prediction complete: ${rawDetections.length} boxes.`);
    loadSavedPredictions();
  };

  const handleDrag = (id: string, node: Konva.Rect) => {
    setDetections((current) =>
      current.map((detection) =>
        detection.id === id
          ? {
              ...detection,
              x: node.x() / stageSize.scale,
              y: node.y() / stageSize.scale,
            }
          : detection
      )
    );
  };

  const handleTransform = (id: string, node: Konva.Rect) => {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    setDetections((current) =>
      current.map((detection) =>
        detection.id === id
          ? {
              ...detection,
              x: node.x() / stageSize.scale,
              y: node.y() / stageSize.scale,
              width: Math.max((node.width() * scaleX) / stageSize.scale, 8),
              height: Math.max((node.height() * scaleY) / stageSize.scale, 8),
            }
          : detection
      )
    );
  };

  const handleSave = async () => {
    if (!predictionId) {
      setMessage("Run prediction before saving annotations.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    const response = await fetch(`/api/predictions/${predictionId}/annotations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editedDetections: detections.map(toSavedDetection),
        imageDataUrl,
      }),
    });
    const result = (await response.json()) as {
      collection?: string;
      message?: string;
      predictionId?: string;
    };
    setIsSaving(false);
    setMessage(
      response.ok
        ? `Annotation saved to ${result.collection ?? "predictions"} (${result.predictionId ?? predictionId}).`
        : result.message ?? "Save failed."
    );
    if (response.ok) {
      loadSavedPredictions();
    }
  };

  const handleLoadSavedPrediction = async (id: string) => {
    setMessage("");
    setSelectedId("");
    setHoveredId("");

    const response = await fetch(`/api/predictions/${id}`);
    const result = (await response.json()) as {
      message?: string;
      prediction?: SavedPredictionDetail;
    };

    if (!response.ok || !result.prediction) {
      setMessage(result.message ?? "Could not load saved result.");
      return;
    }

    const saved = result.prediction;
    setPredictionId(saved.id);
    setFile(null);
    setImageDataUrl(saved.imageDataUrl);
    setModel(saved.model === "without_medclip" ? "without_medclip" : "with_medclip");
    setThreshold(saved.threshold);
    setDetections(saved.detections.map(normalizeDetection));

    if (!saved.imageDataUrl) {
      setImage(null);
      setMessage("Loaded saved boxes, but this older result has no saved image.");
      return;
    }

    try {
      setImage(await loadImageFromUrl(saved.imageDataUrl));
      setMessage(`Loaded saved result: ${saved.originalFileName}.`);
    } catch {
      setImage(null);
      setMessage("Saved image could not be loaded.");
    }
  };

  if (status === "loading") {
    return <main className="grid min-h-screen place-items-center bg-slate-50">Loading...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Spine X-ray Annotation</h1>
            <p className="text-sm text-slate-500">Predict, review, adjust, and save bounding boxes.</p>
          </div>
          {session?.user?.email ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">{session.user.email}</span>
              <button
                className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-white"
                onClick={() => signOut()}
              >
                Logout
              </button>
            </div>
          ) : null}
        </header>

        {!session?.user?.email ? (
          <section className="mx-auto w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 grid grid-cols-2 rounded-md border border-slate-200 bg-slate-50 p-1">
              <button
                className={`h-9 rounded px-3 text-sm font-semibold ${
                  authMode === "login" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"
                }`}
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                  setAuthMessage("");
                }}
                type="button"
              >
                Login
              </button>
              <button
                className={`h-9 rounded px-3 text-sm font-semibold ${
                  authMode === "register" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"
                }`}
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                  setAuthMessage("");
                }}
                type="button"
              >
                Register
              </button>
            </div>

            <h2 className="text-lg font-semibold">
              {authMode === "login" ? "User login" : "Create account"}
            </h2>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={authMode === "login" ? handleLogin : handleRegister}
            >
              {authMode === "register" ? (
                <input
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-teal-600"
                  placeholder="Name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              ) : null}
              <input
                className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-teal-600"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <input
                className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-teal-600"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
              {authMessage ? <p className="text-sm text-teal-700">{authMessage}</p> : null}
              <button className="h-10 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">
                {authMode === "login" ? "Login" : isRegistering ? "Creating..." : "Create account"}
              </button>
            </form>
          </section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
            <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <section>
                <h2 className="text-sm font-semibold uppercase text-slate-500">1. Upload X-ray image</h2>
                <input
                  className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setImage(null);
                    setImageDataUrl("");
                    setPredictionId("");
                    setDetections([]);
                    setSelectedId("");
                    setHoveredId("");
                    setMessage("");
                  }}
                />
                {file ? <p className="mt-2 text-sm text-slate-600">{file.name}</p> : null}
              </section>

              <section>
                <h2 className="text-sm font-semibold uppercase text-slate-500">2. Choose model</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(Object.keys(modelLabels) as ModelChoice[]).map((choice) => (
                    <button
                      key={choice}
                      className={`min-h-11 rounded-md border px-3 text-sm font-medium ${
                        model === choice
                          ? "border-teal-700 bg-teal-50 text-teal-900"
                          : "border-slate-300 hover:bg-slate-50"
                      }`}
                      onClick={() => setModel(choice)}
                      type="button"
                    >
                      {modelLabels[choice]}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase text-slate-500">3. Threshold</h2>
                  <span className="text-sm font-semibold text-slate-900">{threshold.toFixed(2)}</span>
                </div>
                <input
                  className="mt-3 w-full accent-teal-700"
                  max="1"
                  min="0"
                  step="0.01"
                  type="range"
                  value={threshold}
                  onChange={(event) => setThreshold(Number(event.target.value))}
                />
              </section>

              <button
                className="h-11 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={isPredicting || !file}
                onClick={handlePredict}
                type="button"
              >
                {isPredicting ? "Predicting..." : "Predict"}
              </button>

              <button
                className="h-11 rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isSaving || !predictionId}
                onClick={handleSave}
                type="button"
              >
                {isSaving ? "Saving..." : "Save Annotation"}
              </button>

              {message ? <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p> : null}

              <section className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase text-slate-500">Saved results</h2>
                  <button
                    className="text-sm font-medium text-teal-700 hover:text-teal-900"
                    onClick={loadSavedPredictions}
                    type="button"
                  >
                    Refresh
                  </button>
                </div>
                <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-auto">
                  {isLoadingSaved ? (
                    <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">Loading...</p>
                  ) : null}
                  {!isLoadingSaved && savedPredictions.length === 0 ? (
                    <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">No saved results yet.</p>
                  ) : null}
                  {savedPredictions.map((saved) => (
                    <button
                      key={saved.id}
                      className={`rounded-md border px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        predictionId === saved.id ? "border-teal-600 bg-teal-50" : "border-slate-200"
                      }`}
                      onClick={() => handleLoadSavedPrediction(saved.id)}
                      type="button"
                    >
                      <span className="block truncate font-semibold">{saved.originalFileName}</span>
                      <span className="block text-slate-500">
                        {saved.detectionCount} boxes · {modelLabels[saved.model as ModelChoice] ?? saved.model}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {saved.updatedAt ? new Date(saved.updatedAt).toLocaleString() : "No update time"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </aside>

            <section className="min-h-[560px] rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Image and bounding boxes</h2>
                <span className="text-sm text-slate-500">{detections.length} boxes</span>
              </div>
              <div ref={stageWrapRef} className="overflow-auto rounded-md border border-slate-200 bg-slate-100 p-3">
                <Stage
                  width={stageSize.width}
                  height={stageSize.height}
                  onMouseDown={(event) => {
                    if (event.target === event.target.getStage()) setSelectedId("");
                  }}
                  onMouseLeave={() => setHoveredId("")}
                >
                  <Layer>
                    {image ? (
                      <KonvaImage image={image} width={stageSize.width} height={stageSize.height} />
                    ) : (
                      <Text
                        align="center"
                        fill="#64748b"
                        fontSize={16}
                        text="Upload an X-ray image to begin"
                        verticalAlign="middle"
                        width={stageSize.width}
                        height={stageSize.height}
                      />
                    )}
                    {detections.map((detection) => (
                      <Group
                        key={detection.id}
                        onMouseEnter={() => setHoveredId(detection.id)}
                        onMouseLeave={() => setHoveredId("")}
                      >
                        {selectedId === detection.id || hoveredId === detection.id ? (
                          <Label
                            x={detection.x * stageSize.scale}
                            y={Math.max(detection.y * stageSize.scale - 24, 0)}
                          >
                            <Tag
                              fill={detectionColor(detection.label)}
                              lineJoin="round"
                              opacity={0.94}
                            />
                            <Text
                              fill="white"
                              fontSize={13}
                              fontStyle="bold"
                              padding={5}
                              text={detectionCaption(detection)}
                            />
                          </Label>
                        ) : null}
                        <Rect
                          ref={(node) => {
                            rectRefs.current[detection.id] = node;
                          }}
                          draggable
                          height={detection.height * stageSize.scale}
                          opacity={selectedId === detection.id || hoveredId === detection.id ? 0.9 : 0.72}
                          stroke={selectedId === detection.id ? "#f97316" : detectionColor(detection.label)}
                          strokeWidth={selectedId === detection.id ? 4 : hoveredId === detection.id ? 3.5 : 3}
                          width={detection.width * stageSize.scale}
                          x={detection.x * stageSize.scale}
                          y={detection.y * stageSize.scale}
                          onClick={() => setSelectedId(detection.id)}
                          onTap={() => setSelectedId(detection.id)}
                          onDragEnd={(event) => handleDrag(detection.id, event.target as Konva.Rect)}
                          onTransformEnd={(event) => handleTransform(detection.id, event.target as Konva.Rect)}
                        />
                      </Group>
                    ))}
                    <Transformer
                      ref={transformerRef}
                      boundBoxFunc={(oldBox, newBox) =>
                        newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
                      }
                      rotateEnabled={false}
                    />
                  </Layer>
                </Stage>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {detections.map((detection) => (
                  <button
                    key={detection.id}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${
                      selectedId === detection.id
                        ? "border-orange-400 bg-orange-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                    onClick={() => setSelectedId(detection.id)}
                    onMouseEnter={() => setHoveredId(detection.id)}
                    onMouseLeave={() => setHoveredId("")}
                    type="button"
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <span
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: detectionColor(detection.label) }}
                      />
                      {detection.label}
                    </span>
                    <span className="text-slate-500">
                      confidence {confidenceText(detection.confidence)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
