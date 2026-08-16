#version 300 es
precision highp float;

// ---- Radial repeat sample shader -------------------------------------------
// Exercises every uniform kind the editor supports:
//   sampler2D  uTexture        (reserved: the node's own texture, auto-bound)
//   sampler2D  uMask           (an asset texture picked from the library)
//   int        uRepeatCount    (radial slices the sample repeats into)
//   float      uIntensity      (0 = plain texture, 1 = full effect)
//   float      uGlow           (brightness boost on bright areas)
//   vec2       uCenter         (center of the radial pattern, uv 0..1)
//   vec3       uColorOdd       (tint of odd slices — color picker in the UI)
//   vec3       uColorEven      (tint of even slices — color picker in the UI)
//   vec4       uOverlayColor   (final overlay tint, alpha 0 disables — picker)
//   bool       uSubtract       (subtract the mask instead of multiplying)
//
// Suggested defaults (set in the Uniform Defaults editor after import):
//   uRepeatCount 4, uIntensity 1, uCenter (0.5, 0.5),
//   uColorOdd (1.0, 0.9, 0.5), uColorEven (0.5, 0.8, 1.0)
// ----------------------------------------------------------------------------

in vec2 vUv;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform int uRepeatCount;
uniform float uIntensity;
uniform float uGlow;
uniform vec2 uCenter;
uniform vec3 uColorOdd;
uniform vec3 uColorEven;
uniform vec4 uOverlayColor;
uniform bool uSubtract;

out vec4 fragColor;

const float TAU = 6.28318530718;

void main() {
  // Slice the circle into uRepeatCount wedges; the sample repeats radially.
  int slices = max(uRepeatCount, 1);
  float wedge = TAU / float(slices);

  vec2 offset = vUv - uCenter;
  float angle = atan(offset.y, offset.x);
  float radius = length(offset);

  // Which wedge this pixel falls into, folded back onto the first wedge.
  float sliceIndex = floor(angle / wedge + 0.5);
  float mirrored = angle - sliceIndex * wedge;

  vec2 radial = vec2(cos(mirrored), sin(mirrored)) * radius;
  vec2 sampleUv = clamp(radial + uCenter, 0.0, 1.0);

  vec4 color = texture(uTexture, sampleUv);

  // Odd slices tint with uColorOdd, even slices with uColorEven.
  bool oddSlice = mod(sliceIndex, 2.0) > 0.5;
  vec3 sliceTint = oddSlice ? uColorOdd : uColorEven;
  color.rgb *= mix(vec3(1.0), sliceTint, uIntensity);

  // The library-picked mask texture: multiplied, or subtracted when enabled.
  vec4 mask = texture(uMask, sampleUv);
  float maskAmount = dot(mask.rgb, vec3(0.299, 0.587, 0.114));
  if (uSubtract) {
    color.rgb -= mask.rgb * maskAmount * uIntensity;
  } else {
    color.rgb *= mix(vec3(1.0), mask.rgb, uIntensity);
  }

  // Soft glow on bright areas.
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb += vec3(luma * luma * uGlow);

  // Final overlay tint, blended by its alpha.
  color.rgb = mix(color.rgb, uOverlayColor.rgb, uOverlayColor.a * uIntensity);

  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}
