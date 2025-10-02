import "./assets/App.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

function App() {
  const [benchmarkHistory, setBenchmarkHistory] = useState([]);
  const [currentBenchmark, setCurrentBenchmark] = useState({
    warmUpTime: "0.00",
    inferenceTime: "0.00",
    avgInferenceTime: "0.00",
    status: "Model Not Loaded",
  });
  const [isRunning, setIsRunning] = useState(false);
  const [selectedModels, setSelectedModels] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [inferenceTimes, setInferenceTimes] = useState([]);

  const backendSelectorRef = useRef(null);
  const modelSelectorRef = useRef(null);
  const inferenceCountRef = useRef(null);
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const inference_workerRef = useRef(null);

  // Initialize chart and worker
  useEffect(() => {
    // Initialize chart
    if (chartRef.current) {
      const ctx = chartRef.current.getContext("2d");
      chartInstanceRef.current = new Chart(ctx, {
        type: "bar",
        data: {
          labels: [],
          datasets: [
            {
              label: "Warm Up Time (ms)",
              data: [],
              backgroundColor: "rgba(251, 191, 36, 0.8)",
              borderColor: "rgb(251, 191, 36)",
              borderWidth: 1,
            },
            {
              label: "Avg Inference Time (ms)",
              data: [],
              backgroundColor: "rgba(34, 197, 94, 0.8)",
              borderColor: "rgb(34, 197, 94)",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                color: "#e5e7eb",
              },
              grid: {
                color: "rgba(255, 255, 255, 0.1)",
              },
            },
            x: {
              ticks: {
                color: "#e5e7eb",
              },
              grid: {
                color: "rgba(255, 255, 255, 0.1)",
              },
            },
          },
          plugins: {
            legend: {
              labels: {
                color: "#e5e7eb",
              },
            },
          },
        },
      });
    }

    // Initialize worker
    const inference_worker = new Worker(
      new URL("./utils/inference_worker.js", import.meta.url),
      { type: "module" }
    );

    inference_worker.onmessage = function (e) {
      const { type, warmUpTime, inferenceTime, status } = e.data;

      if (type === "status" || type === "warmup") {
        // 更新 Warm Up 時間
        setCurrentBenchmark((prev) => ({
          ...prev,
          warmUpTime: warmUpTime.toFixed(2),
          status: status,
        }));

        if (type === "warmup") {
          // Warm up 完成，重置推理時間陣列
          setInferenceTimes([]);
        }
      } else if (type === "inference") {
        // 推理階段 - 即時更新
        setInferenceTimes((prev) => {
          const newTimes = [...prev, inferenceTime];
          const avgTime = newTimes.reduce((a, b) => a + b, 0) / newTimes.length;

          setCurrentBenchmark((prevBenchmark) => ({
            ...prevBenchmark,
            warmUpTime: warmUpTime.toFixed(2),
            inferenceTime: inferenceTime.toFixed(2),
            avgInferenceTime: avgTime.toFixed(2),
            status: status,
          }));

          return newTimes;
        });
      } else if (type === "complete") {
        // 完成
        setIsRunning(false);
        setCurrentBenchmark((prev) => ({
          ...prev,
          status: status,
        }));
      } else if (type === "error") {
        // 錯誤處理
        setIsRunning(false);
        setCurrentBenchmark({
          warmUpTime: "0.00",
          inferenceTime: "0.00",
          avgInferenceTime: "0.00",
          status: status,
        });
      }
    };

    inference_workerRef.current = inference_worker;

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
      if (inference_workerRef.current) {
        inference_workerRef.current.terminate();
      }
    };
  }, []);

  const handle_startBenchmark = useCallback(async () => {
    setIsRunning(true);
    setInferenceTimes([]);

    const inferenceCount = parseInt(inferenceCountRef.current.value);

    setCurrentBenchmark({
      warmUpTime: "0.00",
      inferenceTime: "0.00",
      avgInferenceTime: "0.00",
      status: "Starting Benchmark...",
    });

    // Get model path
    const selectedValue = modelSelectorRef.current.value;

    // 判斷是否為自訂模型 (blob URL)
    const model_path = selectedValue.startsWith("blob:")
      ? selectedValue
      : `${window.location.origin}${window.location.pathname}models/${selectedValue}.onnx`;

    // start benchmark
    inference_workerRef.current.postMessage({
      model_path: model_path,
      backend: backendSelectorRef.current.value,
      inferenceCount: inferenceCount,
    });
  }, []);

  // Handle model upload
  const handle_UploadModel = useCallback((event) => {
    const file = event.target.files[0];
    if (file) {
      const fileName = file.name.replace(".onnx", "");
      const fileUrl = URL.createObjectURL(file);
      setCustomModels((prevModels) => [
        ...prevModels,
        { name: fileName, url: fileUrl },
      ]);
    }
  }, []);

  const handle_addPerformance = useCallback(() => {
    const backend = backendSelectorRef.current.value;
    const modelName =
      modelSelectorRef.current.options[modelSelectorRef.current.selectedIndex]
        .text;

    const newEntry = {
      id: Date.now(),
      backend,
      model: modelName,
      warmUp: currentBenchmark.warmUpTime,
      avgInference: currentBenchmark.avgInferenceTime,
      inferenceCount: inferenceTimes.length,
      timestamp: new Date().toLocaleString(),
    };

    setBenchmarkHistory((prev) => [...prev, newEntry]);
    setSelectedModels((prev) => [...prev, newEntry]);

    // Update chart
    if (chartInstanceRef.current) {
      chartInstanceRef.current.data.labels.push(`${modelName}\n(${backend})`);
      chartInstanceRef.current.data.datasets[0].data.push(
        parseFloat(currentBenchmark.warmUpTime)
      );
      chartInstanceRef.current.data.datasets[1].data.push(
        parseFloat(currentBenchmark.avgInferenceTime)
      );
      chartInstanceRef.current.update();
    }
  }, [currentBenchmark, inferenceTimes]);

  const handle_removeModel = useCallback((id) => {
    setSelectedModels((prev) => {
      const newModels = prev.filter((m) => m.id !== id);

      // Update chart
      if (chartInstanceRef.current) {
        const index = prev.findIndex((m) => m.id === id);
        if (index !== -1) {
          chartInstanceRef.current.data.labels.splice(index, 1);
          chartInstanceRef.current.data.datasets[0].data.splice(index, 1);
          chartInstanceRef.current.data.datasets[1].data.splice(index, 1);
          chartInstanceRef.current.update();
        }
      }

      return newModels;
    });
  }, []);

  return (
    <div className="container py-4">
      <h1 className="text-center mb-4 fw-bold">
        <span>YOLO ONNX</span>
        <span> </span>
        <span className="gradient-title">Model Benchmark</span>
      </h1>

      {/* Settings Panel */}
      <div className="card bg-dark text-light mb-4 shadow">
        <div className="card-body">
          <h5 className="card-title fw-bold mb-3 pb-2 border-bottom border-secondary">
            Model Settings
          </h5>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label fw-semibold">
                <i className="bi bi-cpu me-2"></i>Backend
              </label>
              <select
                ref={backendSelectorRef}
                className="form-select"
                disabled={isRunning}
              >
                <option value="wasm">Wasm (CPU)</option>
                <option value="webgpu">WebGPU</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold">
                <i className="bi bi-box me-2"></i>Model
              </label>
              <select
                ref={modelSelectorRef}
                className="form-select"
                disabled={isRunning}
              >
                {customModels.map((model, index) => (
                  <option key={index} value={model.url}>
                    {model.name}
                  </option>
                ))}
                <option value="yolo12s">yolo12s - 9.3M</option>
                <option value="yolo12n">yolo12n - 2.6M</option>
                <option value="yolo11m">yolo11m - 20.1M</option>
                <option value="yolo11s">yolo11s - 9.4M</option>
                <option value="yolo11n">yolo11n - 2.6M</option>
                <option value="yolov10s">yolov10s - 7.2M</option>
                <option value="yolov10n">yolov10n - 2.3M</option>
                <option value="yolov9s">yolov9s - 7.2M</option>
                <option value="yolov9t">yolov9t - 2.0M</option>
                <option value="yolov8s">yolov8s - 11.2M</option>
                <option value="yolov8n">yolov8n - 3.2M</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold">
                <i className="bi bi-arrow-repeat me-2"></i>Inference Counts
              </label>
              <input
                type="number"
                className="form-control"
                defaultValue={100}
                min={1}
                max={1000}
                step={10}
                ref={inferenceCountRef}
                disabled={isRunning}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Chart Display */}
      <div className="card bg-dark text-light mb-4 shadow">
        <div className="card-body">
          <h5 className="card-title mb-3">
            <i className="bi bi-bar-chart-fill me-2"></i>
            Performance Comparison
          </h5>
          <div style={{ height: "400px", position: "relative" }}>
            <canvas ref={chartRef}></canvas>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="card bg-dark text-light mb-4 shadow">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <button
                className="btn btn-primary w-100"
                onClick={handle_startBenchmark}
                disabled={isRunning}
              >
                <i className="bi bi-play-fill me-2"></i>
                {isRunning ? "Running..." : "Start Benchmark"}
              </button>
            </div>
            <div className="col-md-4">
              <button
                className="btn btn-success w-100"
                onClick={handle_addPerformance}
                disabled={
                  isRunning || currentBenchmark.status === "Model Not Loaded"
                }
              >
                <i className="bi bi-plus-circle-fill me-2"></i>
                Add to Comparison
              </button>
            </div>
            <div className="col-md-4">
              <button
                className="btn btn-secondary w-100"
                onClick={(e) => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".onnx";
                  input.onchange = handle_UploadModel;
                  input.click();
                }}
                disabled={isRunning}
              >
                <i className="bi bi-upload me-2"></i>
                Upload Model
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Current Performance Status */}
      <div className="card bg-dark text-light mb-4 shadow">
        <div className="card-body">
          <h5 className="card-title fw-bold mb-3 pb-2 border-bottom border-secondary">
            Current Model Performance
          </h5>
          <div className="row g-3 mb-3">
            <div className="col-md-4">
              <div className="card performance-card">
                <div className="card-body">
                  <div className="performance-label">Warm Up Time</div>
                  <div className="performance-value text-warning">
                    {currentBenchmark.warmUpTime} ms
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="card performance-card">
                <div className="card-body">
                  <div className="performance-label">Current Inference</div>
                  <div className="performance-value text-info">
                    {currentBenchmark.inferenceTime} ms
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="card performance-card">
                <div className="card-body">
                  <div className="performance-label">Avg Inference Time</div>
                  <div className="performance-value text-success">
                    {currentBenchmark.avgInferenceTime} ms
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="card status-card">
            <div className="card-body">
              <div
                className={`spinner-grow spinner-grow-sm me-3 ${
                  isRunning ? "text-primary" : "text-muted"
                }`}
                role="status"
              >
                <span className="visually-hidden">Loading...</span>
              </div>
              <span className={isRunning ? "text-primary" : "text-muted"}>
                {currentBenchmark.status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Models for Comparison */}
      {selectedModels.length > 0 && (
        <div className="card bg-dark text-light mb-4 shadow">
          <div className="card-body">
            <h5 className="card-title fw-bold mb-3 pb-2 border-bottom border-secondary">
              <i className="bi bi-layers-fill me-2"></i>
              Models in Comparison ({selectedModels.length})
            </h5>
            <div className="table-responsive">
              <table className="table table-dark table-hover">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Backend</th>
                    <th>Warm Up (ms)</th>
                    <th>Avg Inference (ms)</th>
                    <th>Runs</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedModels.map((model) => (
                    <tr key={model.id}>
                      <td className="fw-semibold">{model.model}</td>
                      <td>
                        <span className="badge bg-primary">
                          {model.backend}
                        </span>
                      </td>
                      <td className="text-warning">{model.warmUp}</td>
                      <td className="text-success">{model.avgInference}</td>
                      <td className="text-info">{model.inferenceCount}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handle_removeModel(model.id)}
                        >
                          <i className="bi bi-trash-fill"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Benchmark History */}
      <div className="card bg-dark text-light shadow">
        <div className="card-body">
          <details>
            <summary className="cursor-pointer user-select-none border-bottom">
              <div>
                <span className="h5 mb-0 fw-bold">
                  Benchmark History ({benchmarkHistory.length})
                </span>
              </div>
            </summary>
            <div className="mt-3">
              {benchmarkHistory.length === 0 ? (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-inbox display-4 d-block mb-3"></i>
                  <p>No benchmark history yet</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-dark table-striped">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Model</th>
                        <th>Backend</th>
                        <th>Warm Up (ms)</th>
                        <th>Avg Inference (ms)</th>
                        <th>Runs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarkHistory.map((entry) => (
                        <tr key={entry.id}>
                          <td className="small">{entry.timestamp}</td>
                          <td className="fw-semibold">{entry.model}</td>
                          <td>
                            <span className="badge bg-primary">
                              {entry.backend}
                            </span>
                          </td>
                          <td className="text-warning">{entry.warmUp}</td>
                          <td className="text-success">{entry.avgInference}</td>
                          <td className="text-info">{entry.inferenceCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

export default App;
