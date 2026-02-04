# SolidFL Mobile — Privacy-Preserving Data Sharing with On-Device LLMs

SolidFL Mobile is a research prototype demonstrating how **on-device Large Language Models (LLMs)** and **mobile perception models** can be combined with **Solid Pods** to enable **privacy-first, user-controlled data sharing** from data-rich personal devices.

The system allows users to express data-sharing intentions in natural language (e.g. *“Upload pictures of flowers from my recent camera roll”*), while all perception, reasoning, and decision-making occurs locally on the device. Only explicitly selected data is uploaded to a user-owned Solid Pod.

**Status**:  
The codebase will be released publicly **shortly** following final cleanup and documentation.

---

## Motivation

Modern smartphones contain vast amounts of sensitive personal data, yet current data-sharing workflows often rely on:
- bulk uploads,
- opaque consent dialogs, and
- centralized cloud services.

This project explores an alternative model where:
- data never leaves the device unless explicitly selected,
- users remain in control through natural language interaction,
- storage and access are delegated to decentralized, user-owned Solid Pods.

---

## System Overview

The prototype integrates three core components:

### 1. On-Device Image Classification
- Lightweight image classification models optimized for mobile hardware
- Used to assign **coarse semantic categories** (e.g. *flowers*) to images
- Runs fully offline on the device

### 2. On-Device Large Language Model
- A compact LLM deployed locally on the phone
- Interprets user intent expressed in natural language
- Selects candidate data items based on classification metadata
- Acts as a **privacy mediator**, not an autonomous uploader

### 3. Solid Pod Storage
- Selected files are uploaded directly to the user’s Solid Pod
- Uses Solid OIDC authentication and standard HTTP PUT
- Fine-grained, revocable access control enforced by Solid

At no point are raw images, metadata, or user instructions sent to third-party cloud services.

---

## Model Details

### Language Model
- **Base model**: Qwen3-0.6B
- **Deployment**: Quantized for mobile inference
- **Fine-tuning**: Performed using the Unsloth framework
- **Training data**: A custom dataset of privacy-focused interaction examples
  generated to reflect localized, on-device data governance use cases

Fine-tuning emphasizes:
- structured outputs,
- conservative data selection,
- alignment with privacy-first intent interpretation.

### Vision Model
- Mobile-optimized convolutional neural network
- Used for **image classification** (not full object detection)
- Designed for low latency and energy efficiency

---

## Implementation

- **Platform**: iOS (React Native + Expo)
- **Authentication**: Solid OIDC with PKCE (public client)
- **LLM Runtime**: Local inference (no API calls)
- **Upload Path**: Direct device → Solid Pod transfer
- **No backend server required**

The architecture is intentionally modular, allowing models or storage backends to be swapped without altering trust boundaries.

---

## Privacy Guarantees

- All perception and reasoning happens **on device**
- No raw data sent to cloud services
- Explicit user intent required for every upload
- Solid Pods provide revocable, auditable access control
- Favors under-sharing over bulk sharing

The system is designed to make **privacy violations harder by default**, even in the presence of model errors.

---

## Research Context

This prototype accompanies the paper:

> **“From Camera Roll to Solid Pod: LLM-Facilitated Privacy-Preserving Data Sharing on Mobile Devices”**  
> Solid Symposium 2026 — Privacy & Personal Data Management

It is intended as a **proof-of-concept**, not a production system.

---

## Code Release

🚧 **Coming soon** 🚧  
The full source code, including:
- mobile application,
- on-device LLM integration,
- image classification pipeline,
- Solid Pod interaction logic,

will be released shortly after final review and documentation.

---

## 📽 Demo

A short video demonstration of the system is included in the repository root:

- [`demo.mov`](./demo.mov)

The video shows:
- Solid OIDC login
- On-device image classification
- Natural language instruction parsing
- Privacy-preserving upload of selected images to a Solid Pod

> GitHub will render the video inline on the repository page.

---

## 🏗 System Architecture

The overall system architecture is illustrated below:

![System Architecture](./arch.png)

The figure shows the separation between:
- On-device perception and reasoning
- User intent mediation via a local LLM
- Decentralized data storage using Solid Pods

---

## 📄 License

This project is released under the **MIT License**.

You are free to use, modify, and distribute this software, including for commercial purposes, provided that proper attribution is given and the original license text is included with any substantial portion of the software.

If you use this code in academic work or derivative projects, please cite the associated paper:

> *From Camera Roll to Solid Pod: LLM-Facilitated Privacy-Preserving Data Sharing on Mobile Devices*, Solid Symposium 2026

---
