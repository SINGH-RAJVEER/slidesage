/* Stylized black liquid horizon. The slide belt supplies the orbiting light;
   all reflections are confined to the surface, with no luminous rim or disk. */

export const WORDMARK_ORB_VERTEX_SHADER =
	"attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

export const WORDMARK_ORB_FRAGMENT_SHADER = `
precision highp float;
uniform float uT;
uniform float uExpansion;
uniform vec2 uR;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
		f.y
	);
}

float fbm(vec2 p) {
	float value = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < 4; i++) {
		value += amplitude * noise(p);
		p = p * 2.03 + vec2(9.2, 3.7);
		amplitude *= 0.5;
	}
	return value;
}

void main() {
	vec2 uv = (gl_FragCoord.xy - 0.5 * uR) / min(uR.x, uR.y);
	float radius = length(uv);
	float angle = atan(uv.y, uv.x);
	float boundary = 0.30 + 0.0025 * sin(angle * 3.0 + uT * 0.24)
		+ 0.0015 * sin(angle * 5.0 - uT * 0.19);
	float aa = 1.5 / min(uR.x, uR.y);
	float alpha = 1.0 - smoothstep(boundary - aa, boundary, radius);
	if (alpha <= 0.0) {
		gl_FragColor = vec4(0.0);
		return;
	}

	vec2 p = uv / boundary;
	float z = sqrt(max(0.0, 1.0 - dot(p, p)));
	float flow = fbm(p * 2.3 + vec2(uT * 0.07, -uT * 0.045));
	vec3 normal = normalize(vec3(p + (flow - 0.5) * 0.13, z));
	/* Broad, distorted studio reflections make the black material playful
	   and glassy. Their positions drift without spinning a rigid texture. */
	vec3 upperLight = normalize(vec3(-0.55 + sin(uT * 0.19) * 0.12, 0.65, 0.60));
	vec3 sideLight = normalize(vec3(0.78, -0.30 + sin(uT * 0.23) * 0.14, 0.48));
	float upper = pow(max(dot(normal, upperLight), 0.0), 24.0);
	float side = pow(max(dot(normal, sideLight), 0.0), 38.0);
	float glint = pow(max(dot(normal, upperLight), 0.0), 105.0);
	float veil = smoothstep(0.48, 0.76, flow) * 0.035;
	/* Reflections taper off inside the silhouette, never outlining it. */
	float inset = 1.0 - smoothstep(0.83, 1.0, length(p));
	// Hue follows the already-smoothed expansion, so it reverses with size.
	float blue = smoothstep(0.0, 1.0, uExpansion);
	vec3 color = mix(vec3(0.002, 0.003, 0.006), vec3(0.004, 0.012, 0.029), blue);
	color += inset * blue * vec3(0.003, 0.010, 0.024) * z;
	color += vec3(0.045, 0.080, 0.13) * veil;
	color += inset * (mix(vec3(0.25, 0.31, 0.39), vec3(0.20, 0.32, 0.49), blue) * upper
		+ mix(vec3(0.045, 0.13, 0.24), vec3(0.035, 0.16, 0.34), blue) * side
		+ vec3(0.22, 0.26, 0.30) * glint);
	gl_FragColor = vec4(color, alpha);
}
`;
