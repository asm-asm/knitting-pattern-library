import Foundation
import AVFoundation
import UIKit
import Capacitor

/// 本の裏のバーコード（ISBN）をカメラで読み取るプラグイン。
/// 映像は端末内で処理するだけで、保存も送信もしない。
@objc(BarcodeScannerPlugin)
public class BarcodeScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BarcodeScannerPlugin"
    public let jsName = "BarcodeScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                self.present(call)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    DispatchQueue.main.async {
                        if granted { self.present(call) } else { call.reject("camera permission denied", "DENIED") }
                    }
                }
            default:
                call.reject("camera permission denied", "DENIED")
            }
        }
    }

    private func present(_ call: CAPPluginCall) {
        guard let host = bridge?.viewController else {
            call.reject("no view controller", "UNAVAILABLE")
            return
        }
        let vc = IsbnScannerViewController()
        vc.onFinish = { value in
            if let value = value {
                call.resolve(["value": value])
            } else {
                call.resolve(["cancelled": true])
            }
        }
        vc.modalPresentationStyle = .fullScreen
        host.present(vc, animated: true)
    }
}

final class IsbnScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onFinish: ((String?) -> Void)?
    private let session = AVCaptureSession()
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            finish(nil)
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.ean13]
        }

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        // 読み取り枠と案内
        let guide = UIView()
        guide.layer.borderColor = UIColor.white.cgColor
        guide.layer.borderWidth = 3
        guide.layer.cornerRadius = 12
        guide.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(guide)

        let label = UILabel()
        label.text = "本の裏の「978」から始まる\nバーコードを枠に合わせてください"
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.font = .boldSystemFont(ofSize: 17)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)

        var config = UIButton.Configuration.filled()
        config.title = "キャンセル"
        config.baseBackgroundColor = UIColor(white: 1, alpha: 0.9)
        config.baseForegroundColor = .black
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 28, bottom: 12, trailing: 28)
        let cancel = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
        cancel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cancel)

        NSLayoutConstraint.activate([
            guide.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            guide.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            guide.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.8),
            guide.heightAnchor.constraint(equalToConstant: 150),
            label.bottomAnchor.constraint(equalTo: guide.topAnchor, constant: -24),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -32)
        ])

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.startRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.layer.sublayers?.compactMap { $0 as? AVCaptureVideoPreviewLayer }.forEach { $0.frame = view.bounds }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        for case let code as AVMetadataMachineReadableCodeObject in metadataObjects {
            // 日本の本には2段のバーコードがある。上段の ISBN（978/979 で始まる）だけを使う
            guard let value = code.stringValue, value.hasPrefix("978") || value.hasPrefix("979") else { continue }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            finish(value)
            return
        }
    }

    private func finish(_ value: String?) {
        guard !finished else { return }
        finished = true
        if session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [session] in session.stopRunning() }
        }
        let done = onFinish
        if presentingViewController != nil {
            dismiss(animated: true) { done?(value) }
        } else {
            done?(value)
        }
    }
}
